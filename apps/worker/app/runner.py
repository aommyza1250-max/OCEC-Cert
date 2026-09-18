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
    merge_batch_stats,
    set_batch_status,
    set_progress,
)
from .tasks.cleanup_sources import run_cleanup_sources
from .tasks.delete_batch import run_delete_batch
from .tasks.match_excel import run_match
from .tasks.split import run_split

log = logging.getLogger(__name__)

# ตั้งค่าเมื่อมีงานใหม่เข้ามา เพื่อให้ลูปตื่นทันทีไม่ต้องรอครบรอบ poll
wake = threading.Event()
_stop = threading.Event()


def start() -> threading.Thread:
    _stop.clear()
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
            worked = _run_one()
        except Exception:  # ลูปต้องไม่ตายเพราะงานชิ้นเดียว
            log.exception("job runner เจอข้อผิดพลาดที่ไม่คาดคิด")
            worked = False

        if not worked:
            # มีงานต่อคิวก็วนทำต่อทันที ไม่มีค่อยรอ
            wake.wait(timeout=interval)
            wake.clear()


def _batch_status(batch_id: str) -> str:
    from .db import connection

    with connection() as conn:
        row = conn.execute(
            "SELECT status FROM batches WHERE id = %s", (batch_id,)
        ).fetchone()
    return row["status"] if row else "DRAFT"


def _queue_cleanup_sources(batch_id: str) -> None:
    """ตั้งงานเคลียร์ไฟล์ต้นฉบับ ถ้ายังไม่เคยเคลียร์และยังไม่มีงานค้างอยู่

    ตัวงานจะตรวจเงื่อนไขเองอีกที ตรงนี้แค่กันไม่ให้ตั้งคิวซ้ำซ้อน
    """
    from .db import connection, new_id

    with connection() as conn:
        row = conn.execute(
            """
            SELECT b.sources_cleared_at,
                   (SELECT COUNT(*) FROM jobs j
                    WHERE j.batch_id = b.id AND j.type = 'CLEANUP_SOURCES'
                      AND j.status IN ('QUEUED', 'RUNNING')) AS pending
            FROM batches b WHERE b.id = %s
            """,
            (batch_id,),
        ).fetchone()
        if not row or row["sources_cleared_at"] or row["pending"]:
            return
        conn.execute(
            "INSERT INTO jobs (id, type, batch_id) VALUES (%s, 'CLEANUP_SOURCES', %s)",
            (new_id(), batch_id),
        )
    log.info("ตั้งงานเคลียร์ไฟล์ต้นฉบับให้ batch %s", batch_id)
    wake.set()


def _queue_match_if_roster_ready(batch_id: str) -> None:
    from .db import connection, new_id

    with connection() as conn:
        row = conn.execute(
            "SELECT source_excel_key FROM batches WHERE id = %s", (batch_id,)
        ).fetchone()
        if not row or not row["source_excel_key"]:
            return
        conn.execute(
            "INSERT INTO jobs (id, type, batch_id) VALUES (%s, 'MATCH', %s)",
            (new_id(), batch_id),
        )
    log.info("ตั้งงานจับคู่ต่อให้ batch %s อัตโนมัติ หลังเติมไฟล์", batch_id)
    wake.set()


def _run_one() -> bool:
    job = claim_next_job()
    if job is None:
        return False

    job_id, batch_id, job_type = job["id"], job["batch_id"], job["type"]
    log.info("เริ่มงาน %s (%s) ของ batch %s", job_id, job_type, batch_id)

    # รอบที่เผยแพร่ไปแล้วต้องยังเผยแพร่อยู่หลังเติมไฟล์หรือจับคู่ใหม่
    # ไม่งั้นผู้ปกครองจะค้นไม่เจอทั้งรอบทันทีที่แอดมินเติมไฟล์ตกหล่นเข้าไป
    previous_status = _batch_status(batch_id)
    was_published = previous_status == "PUBLISHED"

    def on_progress(progress: dict[str, Any]) -> None:
        set_progress(job_id, progress)

    try:
        if job_type == "SPLIT":
            set_batch_status(batch_id, "SPLITTING")
            stats = run_split(batch_id, on_progress, job.get("payload") or {})
            # singlePdf เป็นหมายเหตุของงานชิ้นนี้ (ใช้หน้าไหนของไฟล์ที่อัปมา)
            # ไม่ใช่ยอดของรอบนำเข้า ถ้าเอาไปรวมจะค้างอยู่ในสถิติรอบไปตลอด
            merge_batch_stats(batch_id, {k: v for k, v in stats.items() if k != "singlePdf"})
            set_batch_status(batch_id, "PUBLISHED" if was_published else "SPLIT_DONE")
            # เติมไฟล์ที่ตกหล่นเข้ารอบที่เคยจับคู่ไปแล้ว ให้จับคู่ต่อให้เลย
            # แอดมินจะได้ไม่ต้องอัป Excel ชุดเดิมซ้ำเพียงเพื่อกดจับคู่ใหม่
            if stats.get("mode") == "append" and stats.get("pagesSplit"):
                _queue_match_if_roster_ready(batch_id)
        elif job_type == "MATCH":
            set_batch_status(batch_id, "MATCHING")
            stats = run_match(batch_id, on_progress)
            merge_batch_stats(batch_id, stats)
            set_batch_status(batch_id, "PUBLISHED" if was_published else "READY")
            # จับคู่ใหม่ในรอบที่เผยแพร่ไปแล้ว อาจทำให้เงื่อนไขเคลียร์ไฟล์ต้นฉบับครบพอดี
            if was_published:
                _queue_cleanup_sources(batch_id)
        elif job_type == "CLEANUP_SOURCES":
            stats = run_cleanup_sources(batch_id, on_progress, job.get("payload") or {})
        elif job_type == "DELETE_BATCH":
            # ลบทั้งรอบ — แถว batch หายไปพร้อมกับแถว job ของงานนี้เอง (cascade)
            # จึงห้ามไปแตะ set_batch_status/merge_batch_stats หลังจากนี้
            stats = run_delete_batch(batch_id, on_progress, job.get("payload") or {})
            log.info("งาน %s (ลบรอบนำเข้า) เสร็จแล้ว: %s", job_id, stats)
            return True
        else:
            raise ValueError(f"ไม่รู้จักงานชนิด {job_type}")

        finish_job(job_id, {"stage": "done", **{k: v for k, v in stats.items() if k != "unmatchedRows"}})
        log.info("งาน %s เสร็จแล้ว", job_id)
    except Exception as exc:
        # ความผิดพลาดของไฟล์ที่อัปเข้ามา (หยิบไฟล์ผิดคน, จัดโฟลเดอร์ไม่ถูก) ลองใหม่ไปก็เหมือนเดิม
        # และไม่ได้แปลว่ารอบนำเข้าพัง ของที่นำเข้าไปแล้วยังใช้งานได้ตามปกติ
        permanent = isinstance(exc, ValueError)
        fail_job(job_id, f"{exc}\n{traceback.format_exc()}", job["attempts"] + 1, permanent)

        if permanent:
            set_batch_status(batch_id, previous_status)
        elif job["attempts"] + 1 >= settings().max_attempts:
            # พังด้วยเหตุอื่นจนหมดโควต้าลองใหม่ ให้ batch แสดงว่าพัง แอดมินจะได้เห็น
            set_batch_status(batch_id, "FAILED")

    return True
