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


def _run_one() -> bool:
    job = claim_next_job()
    if job is None:
        return False

    job_id, batch_id, job_type = job["id"], job["batch_id"], job["type"]
    log.info("เริ่มงาน %s (%s) ของ batch %s", job_id, job_type, batch_id)

    def on_progress(progress: dict[str, Any]) -> None:
        set_progress(job_id, progress)

    try:
        if job_type == "SPLIT":
            set_batch_status(batch_id, "SPLITTING")
            stats = run_split(batch_id, on_progress)
            merge_batch_stats(batch_id, stats)
            set_batch_status(batch_id, "SPLIT_DONE")
        elif job_type == "MATCH":
            set_batch_status(batch_id, "MATCHING")
            stats = run_match(batch_id, on_progress)
            merge_batch_stats(batch_id, stats)
            set_batch_status(batch_id, "READY")
        else:
            raise ValueError(f"ไม่รู้จักงานชนิด {job_type}")

        finish_job(job_id, {"stage": "done", **{k: v for k, v in stats.items() if k != "unmatchedRows"}})
        log.info("งาน %s เสร็จแล้ว", job_id)
    except Exception as exc:
        fail_job(job_id, f"{exc}\n{traceback.format_exc()}", job["attempts"] + 1)
        # ถ้าหมดโควต้าลองใหม่แล้ว ให้ batch แสดงว่าพัง แอดมินจะได้เห็น
        if job["attempts"] + 1 >= settings().max_attempts:
            set_batch_status(batch_id, "FAILED")

    return True
