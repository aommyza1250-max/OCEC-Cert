"""ลูปหยิบงานจากคิวมาทำ

รันเป็น thread เดียวข้างใน process ของ FastAPI — ไม่แยก service ต่างหาก
เพราะบน Railway แต่ละ service มีค่าใช้จ่าย และงานมีไม่บ่อยพอจะคุ้ม
"""

import logging
import threading
import traceback
from typing import Any

from .config import settings
from .queue import (
    claim_next_job,
    fail_job,
    finish_job,
    requeue_stale_jobs,
    set_batch_status,
    set_progress,
)
from .tasks.cleanup_sources import run_cleanup_sources
from .tasks.delete_batch import run_delete_batch
from .tasks.expire import run_expire
from .tasks.match import run_match
from .tasks.roster import run_roster_activate, run_roster_validate
from .tasks.split import rollback_job_outputs, run_split

log = logging.getLogger(__name__)

# งานที่แก้ข้อมูลของรอบนำเข้า — ห้ามทำตอนรอบนั้นเผยแพร่อยู่ (ต้องยกเลิกการเผยแพร่ก่อนเสมอ)
INTAKE_JOBS = frozenset({"SPLIT", "MATCH", "ROSTER_VALIDATE", "ROSTER_ACTIVATE"})

# สถานะที่แสดงระหว่างทำงาน — งานตรวจรายชื่อไม่เปลี่ยนสถานะรอบ เพราะไม่แตะข้อมูลที่ใช้อยู่
RUNNING_STATUS = {"SPLIT": "SPLITTING", "MATCH": "MATCHING", "ROSTER_ACTIVATE": "MATCHING"}

# ตั้งค่าเมื่อมีงานใหม่เข้ามา เพื่อให้ลูปตื่นทันทีไม่ต้องรอครบรอบ poll
wake = threading.Event()
_stop = threading.Event()


def start() -> threading.Thread:
    _stop.clear()

    # งานที่ค้างจากรอบก่อน (worker ถูกฆ่ากลางคันตอน deploy) ต้องเอากลับเข้าคิว
    # ไม่งั้นรอบนำเข้าจะค้างอยู่ที่ "กำลังตัดแยกหน้า" ตลอดไปโดยไม่มีอะไรฟ้อง
    try:
        recovered = requeue_stale_jobs()
        if recovered:
            log.warning("เอางานที่ค้างกลับเข้าคิว %s งาน", recovered)
    except Exception:
        log.exception("กู้งานที่ค้างไม่สำเร็จ — ลูปยังทำงานต่อได้ตามปกติ")

    thread = threading.Thread(target=_loop, name="job-runner", daemon=True)
    thread.start()
    log.info("job runner เริ่มทำงานแล้ว")
    return thread


def stop() -> None:
    _stop.set()
    wake.set()


def _loop() -> None:
    interval = settings().poll_interval_sec
    while not _stop.is_set():
        try:
            _queue_daily_expire()
            worked = _run_one()
        except Exception:  # ลูปต้องไม่ตายเพราะงานชิ้นเดียว
            log.exception("job runner เจอข้อผิดพลาดที่ไม่คาดคิด")
            worked = False

        if not worked:
            # มีงานต่อคิวก็วนทำต่อทันที ไม่มีค่อยรอ
            wake.wait(timeout=interval)
            wake.clear()


def _queue_daily_expire() -> None:
    """ตั้งงานกวาดอายุวันละครั้ง

    ไม่ใช้ cron หรือ service แยก เพราะลูปนี้เดินอยู่ตลอดอยู่แล้วและงานมีวันละครั้ง
    ดูจากงาน EXPIRE ล่าสุดว่าเกิน 24 ชั่วโมงหรือยัง ถ้าเครื่องดับไปหลายวัน
    รอบแรกที่กลับมาก็จะตั้งงานให้เอง ไม่มีวันไหนหลุด
    """
    from .db import connection, new_id

    try:
        with connection() as conn:
            recent = conn.execute(
                """
                SELECT 1 FROM jobs
                WHERE type = 'EXPIRE'
                  AND (status IN ('QUEUED', 'RUNNING') OR created_at > NOW() - INTERVAL '24 hours')
                LIMIT 1
                """
            ).fetchone()
            if recent:
                return
            conn.execute("INSERT INTO jobs (id, type) VALUES (%s, 'EXPIRE')", (new_id(),))
        log.info("ตั้งงานกวาดเกียรติบัตรที่ครบอายุประจำวัน")
    except Exception:
        # ตั้งงานไม่ได้ก็ไม่ควรทำให้ลูปทั้งตัวหยุด เดี๋ยวรอบหน้าลองใหม่
        log.exception("ตั้งงานกวาดอายุประจำวันไม่สำเร็จ")


def _batch_status(batch_id: str) -> str | None:
    from .db import connection

    with connection() as conn:
        row = conn.execute(
            "SELECT status::text AS status FROM batches WHERE id = %s", (batch_id,)
        ).fetchone()
    return row["status"] if row else None


def _run_one() -> bool:
    job = claim_next_job()
    if job is None:
        return False

    job_id, batch_id, job_type = str(job["id"]), job["batch_id"], job["type"]
    batch_id = str(batch_id) if batch_id else None
    payload = job.get("payload") or {}
    log.info("เริ่มงาน %s (%s) ของ batch %s", job_id, job_type, batch_id)

    previous_status = _batch_status(batch_id) if batch_id else None

    def on_progress(progress: dict[str, Any]) -> None:
        set_progress(job_id, progress)

    try:
        if job_type in INTAKE_JOBS:
            # เว็บกันไว้แล้วทั้งปุ่มและ API แต่เช็กซ้ำที่นี่ เผื่องานค้างคิวมาตั้งแต่ก่อนกดเผยแพร่
            if previous_status == "PUBLISHED":
                raise ValueError("รอบนี้เผยแพร่อยู่ ต้องยกเลิกการเผยแพร่ก่อนจึงจะนำเข้าหรือแก้ไขได้")
            if previous_status in (None, "DELETING"):
                raise ValueError("รอบนำเข้านี้ถูกลบหรือกำลังถูกลบ")
            if job_type in RUNNING_STATUS:
                set_batch_status(batch_id, RUNNING_STATUS[job_type])

        if job_type == "SPLIT":
            stats = run_split(batch_id, job_id, on_progress, payload)
        elif job_type == "MATCH":
            stats = run_match(batch_id, on_progress, payload)
        elif job_type == "ROSTER_VALIDATE":
            stats = run_roster_validate(batch_id, on_progress, payload)
        elif job_type == "ROSTER_ACTIVATE":
            stats = run_roster_activate(batch_id, on_progress, payload)
            # รายชื่อเปลี่ยน = ผลจับคู่อัตโนมัติเดิมใช้ไม่ได้แล้ว ต้องคำนวณใหม่ทั้งรอบทันที
            stats["match"] = run_match(batch_id, on_progress)
        elif job_type == "EXPIRE":
            # งานของทั้งระบบ ไม่ผูกกับรอบนำเข้าใด batch_id จึงเป็น None
            stats = run_expire(batch_id, on_progress, payload)
        elif job_type == "CLEANUP_SOURCES":
            stats = run_cleanup_sources(batch_id, on_progress, payload)
        elif job_type == "DELETE_BATCH":
            # ลบทั้งรอบ — แถว batch หายไปพร้อมกับแถว job ของงานนี้เอง (cascade)
            # จึงห้ามไปแตะ set_batch_status หรือ finish_job หลังจากนี้
            stats = run_delete_batch(batch_id, on_progress, payload)
            log.info("งาน %s (ลบรอบนำเข้า) เสร็จแล้ว: %s", job_id, stats)
            return True
        else:
            raise ValueError(f"ไม่รู้จักงานชนิด {job_type}")

        if job_type in RUNNING_STATUS:
            set_batch_status(batch_id, _settled_status(batch_id))
        finish_job(job_id, {"stage": "done", **stats})
        log.info("งาน %s เสร็จแล้ว", job_id)
    except Exception as exc:
        _handle_failure(job, job_id, batch_id, job_type, previous_status, exc)

    return True


def _handle_failure(
    job: dict[str, Any], job_id: str, batch_id: str | None, job_type: str,
    previous_status: str | None, exc: Exception,
) -> None:
    # ความผิดพลาดของไฟล์ที่อัปเข้ามา (หยิบไฟล์ผิดคน, จัดโฟลเดอร์ไม่ถูก) ลองใหม่ไปก็เหมือนเดิม
    # และไม่ได้แปลว่ารอบนำเข้าพัง ของที่นำเข้าไปแล้วยังใช้งานได้ตามปกติ
    permanent = isinstance(exc, ValueError)

    if job_type == "SPLIT" and batch_id:
        # ย้อนทุกอย่างที่งานนี้สร้างไว้ ไม่ปล่อยหน้าครึ่ง ๆ กลาง ๆ ค้างในรอบนำเข้า
        # ถ้าจะลองใหม่ ตัวงานก็ย้อนเองอีกรอบตอนเริ่ม จึงทำซ้ำได้ไม่เสียหาย
        try:
            rollback_job_outputs(batch_id, job_id)
        except Exception:
            log.exception("ย้อนงาน %s ไม่สำเร็จ — จะลองอีกครั้งตอนงานนี้เริ่มใหม่", job_id)

    fail_job(job_id, f"{exc}\n{traceback.format_exc()}", job["attempts"] + 1, permanent)
    if not batch_id or job_type not in RUNNING_STATUS:
        return
    if permanent or job["attempts"] + 1 < settings().max_attempts:
        set_batch_status(batch_id, previous_status or "READY")
    else:
        # พังด้วยเหตุอื่นจนหมดโควต้าลองใหม่ ให้ batch แสดงว่าพัง แอดมินจะได้เห็น
        set_batch_status(batch_id, "FAILED")


def _settled_status(batch_id: str) -> str:
    """สถานะหลังงานเสร็จ: มีรายชื่อแล้ว = พร้อมตรวจ ยังไม่มี = ร่าง"""
    from .db import connection

    with connection() as conn:
        row = conn.execute(
            "SELECT active_roster_import_id FROM batches WHERE id = %s", (batch_id,)
        ).fetchone()
    return "READY" if row and row["active_roster_import_id"] else "DRAFT"
