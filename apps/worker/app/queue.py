"""คิวงานบน Postgres

ใช้ SELECT ... FOR UPDATE SKIP LOCKED แทนการติดตั้ง Redis เพิ่ม
เหตุผล: งานมีน้อย (วันละไม่กี่ครั้งตอนแอดมินนำเข้าไฟล์) ไม่คุ้มกับค่า service เพิ่มบน Railway
SKIP LOCKED ทำให้ถ้ามี worker หลายตัวก็ไม่แย่งงานชิ้นเดียวกัน
"""

import json
import logging
from typing import Any

from .config import settings
from .db import connection

log = logging.getLogger(__name__)


def claim_next_job() -> dict[str, Any] | None:
    """หยิบงานถัดไปมาทำ พร้อมล็อกไว้ไม่ให้ worker ตัวอื่นหยิบซ้ำ"""
    with connection() as conn:
        with conn.transaction():
            row = conn.execute(
                """
                SELECT id, type, batch_id, payload, attempts
                FROM jobs
                WHERE status = 'QUEUED'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """
            ).fetchone()

            if row is None:
                return None

            conn.execute(
                """
                UPDATE jobs
                SET status = 'RUNNING',
                    attempts = attempts + 1,
                    locked_at = NOW(),
                    started_at = COALESCE(started_at, NOW())
                WHERE id = %s
                """,
                (row["id"],),
            )
            return row


def set_progress(job_id: str, progress: dict[str, Any]) -> None:
    with connection() as conn:
        conn.execute(
            "UPDATE jobs SET progress = %s WHERE id = %s", (json.dumps(progress), job_id)
        )


def finish_job(job_id: str, progress: dict[str, Any] | None = None) -> None:
    with connection() as conn:
        conn.execute(
            """
            UPDATE jobs
            SET status = 'DONE', finished_at = NOW(), error = NULL,
                progress = COALESCE(%s, progress)
            WHERE id = %s
            """,
            (json.dumps(progress) if progress is not None else None, job_id),
        )


def fail_job(job_id: str, error: str, attempts: int, permanent: bool = False) -> None:
    """งานที่ยังไม่ครบโควต้าความพยายาม ให้กลับไปเข้าคิวใหม่

    `permanent` ใช้กับความผิดพลาดที่ลองใหม่ไปก็ได้ผลเหมือนเดิม เช่นแอดมินหยิบไฟล์ผิดคน
    หรือจัดโฟลเดอร์ใน ZIP ไม่ถูก — ลองซ้ำมีแต่เสียเวลาและทำให้ log รก
    """
    requeue = not permanent and attempts < settings().max_attempts
    with connection() as conn:
        conn.execute(
            """
            UPDATE jobs
            SET status = %s,
                error = %s,
                finished_at = CASE WHEN %s THEN NULL ELSE NOW() END,
                locked_at = NULL
            WHERE id = %s
            """,
            ("QUEUED" if requeue else "FAILED", error[:4000], requeue, job_id),
        )
    log.warning("job %s ล้มเหลว (ครั้งที่ %s): %s", job_id, attempts, error)


def set_batch_status(batch_id: str, status: str) -> None:
    with connection() as conn:
        conn.execute(
            "UPDATE batches SET status = %s, updated_at = NOW() WHERE id = %s",
            (status, batch_id),
        )


def merge_batch_stats(batch_id: str, stats: dict[str, Any]) -> None:
    """รวมค่าใหม่เข้ากับ stats เดิม เพื่อไม่ให้ job ตัดหน้าไปลบสถิติของ job จับคู่ทิ้ง"""
    with connection() as conn:
        conn.execute(
            "UPDATE batches SET stats = stats || %s::jsonb, updated_at = NOW() WHERE id = %s",
            (json.dumps(stats), batch_id),
        )
