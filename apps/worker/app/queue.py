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
    """หยิบงานถัดไปมาทำ พร้อมล็อกไว้ไม่ให้ worker ตัวอื่นหยิบซ้ำ

    รอบนำเข้าเดียวกันทำได้ทีละงานเสมอ — ข้ามงานของรอบที่มีงานกำลังรันอยู่
    และล็อกแถว batch ก่อนตั้งสถานะ เพื่อไม่ให้ไปสวนกับการแก้ไขจากหน้าเว็บที่ถือล็อกเดียวกันอยู่
    (เว็บตรวจว่าไม่มีงานค้างก่อนแก้ภายใต้ล็อกนี้ งานจึงเริ่มกลางการแก้ไขไม่ได้)
    """
    with connection() as conn:
        with conn.transaction():
            row = conn.execute(
                """
                SELECT j.id, j.type, j.batch_id, j.payload, j.attempts
                FROM jobs j
                WHERE j.status = 'QUEUED'
                  AND (j.batch_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM jobs r
                        WHERE r.batch_id = j.batch_id AND r.status = 'RUNNING'))
                ORDER BY j.created_at
                FOR UPDATE OF j SKIP LOCKED
                LIMIT 1
                """
            ).fetchone()

            if row is None:
                return None
            if row["batch_id"]:
                conn.execute("SELECT 1 FROM batches WHERE id = %s FOR UPDATE", (row["batch_id"],))

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


def requeue_stale_jobs() -> int:
    """เอางานที่ค้างสถานะ "กำลังทำ" กลับเข้าคิว — เรียกตอน worker เริ่มทำงาน

    ถ้า worker ถูกฆ่ากลางคัน (deploy ใหม่, เครื่องรีสตาร์ท, แรมหมด) งานที่ทำค้างไว้
    จะติดสถานะ RUNNING ไปตลอดกาล เพราะตัวหยิบงานมองเฉพาะงานที่เป็น QUEUED
    ผลคือรอบนำเข้าค้างอยู่ที่ "กำลังตัดแยกหน้า" ไม่ไปไหน และไม่มีอะไรฟ้องว่าเกิดอะไรขึ้น

    ตอนที่ worker เพิ่งเริ่มทำงาน จะไม่มีงานไหนกำลังรันอยู่จริง (รันแค่ instance เดียว)
    งานที่ยังเป็น RUNNING อยู่จึงเป็นซากจากรอบก่อนแน่นอน เอากลับเข้าคิวได้เลย

    ปลอดภัยกับงานทุกชนิด เพราะออกแบบให้รันซ้ำได้อยู่แล้ว:
    ตัดหน้าใหม่ล้างของเดิมก่อน จับคู่ใหม่ล้างผลอัตโนมัติก่อน ลบไฟล์ข้ามของที่หายไปแล้ว
    """
    with connection() as conn:
        rows = conn.execute(
            """
            UPDATE jobs SET status = 'QUEUED', locked_at = NULL
            WHERE status = 'RUNNING'
            RETURNING id, type
            """
        ).fetchall()

    for row in rows:
        log.warning("งาน %s (%s) ค้างจากรอบก่อน เอากลับเข้าคิวให้ทำใหม่", row["id"], row["type"])
    return len(rows)


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
                user_error = %s,
                finished_at = CASE WHEN %s THEN NULL ELSE NOW() END,
                locked_at = NULL
            WHERE id = %s
            """,
            ("QUEUED" if requeue else "FAILED", error[:4000], permanent, requeue, job_id),
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
