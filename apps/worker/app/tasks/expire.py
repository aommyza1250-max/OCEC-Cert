"""ลบไฟล์เกียรติบัตรที่ครบอายุการเก็บแล้ว

นโยบายคือเก็บไว้ 2 ปีนับจากวันเผยแพร่ แล้วลบไฟล์บน R2 ทิ้ง
**เหลือแถวในฐานข้อมูลไว้** เพื่อให้ยังรู้ว่าเคยออกใบอะไรให้ใคร ตอบคำถามย้อนหลังได้
แต่ผู้ปกครองจะค้นไม่เจอ เพราะหน้าค้นหากรองใบที่ไฟล์ถูกลบแล้วออกไป

ทำไมต้องมี: ถ้าประกาศกับผู้ปกครองว่าเก็บ 2 ปีแล้วไม่ลบจริง จะแย่กว่าไม่ประกาศเลย
และยังทำให้พื้นที่เก็บคงที่แทนที่จะโตขึ้นทุกปี

ความปลอดภัย:
  - ปิดไว้เป็นค่าตั้งต้น (RETENTION_ENABLED=false) เปิดเมื่อทดสอบแล้วเท่านั้น
  - มีโหมด dry-run ดูว่าจะลบอะไรบ้างโดยไม่ลบจริง
  - ใบที่ยังไม่เคยเผยแพร่ไม่มีวันหมดอายุ จึงไม่มีทางโดนกวาด
  - ลบไฟล์แล้วบันทึกทีละก้อน พังกลางทางรันซ้ำได้
"""

import logging
from typing import Any, Callable

from ..config import settings
from ..db import connection
from ..storage import delete_keys

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

# ลบทีละก้อนเท่านี้แล้วบันทึกครั้งหนึ่ง เพื่อให้รันซ้ำต่อจากของเดิมได้ถ้าพังกลางทาง
CHUNK = 200


def run_expire(
    _batch_id: str | None, on_progress: ProgressFn, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    payload = payload or {}
    dry_run = bool(payload.get("dryRun"))
    cfg = settings()

    due = find_due()
    if not due:
        log.info("ไม่มีเกียรติบัตรที่ครบอายุการเก็บ")
        return {"dryRun": dry_run, "due": 0, "deletedCertificates": 0, "deletedFiles": 0}

    sample = [f"{r['name']} ({r['program_code']} {r['round']} {r['year']})" for r in due[:5]]
    log.info("พบเกียรติบัตรครบอายุ %s ใบ เช่น %s", len(due), sample)

    if dry_run or not cfg.retention_enabled:
        reason = "dry-run" if dry_run else "ปิดการลบอัตโนมัติอยู่ (RETENTION_ENABLED=false)"
        log.info("ไม่ลบอะไร เพราะ %s", reason)
        return {
            "dryRun": True,
            "reason": reason,
            "due": len(due),
            "sample": sample,
            "deletedCertificates": 0,
            "deletedFiles": 0,
        }

    deleted_files = 0
    for start in range(0, len(due), CHUNK):
        chunk = due[start : start + CHUNK]
        keys = [k for row in chunk for k in (row["pdf_key"], row["preview_key"]) if k]
        deleted_files += delete_keys(keys)

        with connection() as conn:
            ids = [row["id"] for row in chunk]
            conn.execute(
                """
                UPDATE certificates
                SET files_deleted_at = NOW(), pdf_key = '', preview_key = NULL
                WHERE id = ANY(%s)
                """,
                (ids,),
            )
            conn.execute(
                """
                UPDATE staging_pages SET pdf_key = NULL, preview_key = NULL
                WHERE id IN (SELECT staging_page_id FROM certificates WHERE id = ANY(%s))
                """,
                (ids,),
            )
        on_progress({"stage": "expire", "done": min(start + CHUNK, len(due)), "total": len(due)})

    stats = {"dryRun": False, "due": len(due), "deletedCertificates": len(due),
             "deletedFiles": deleted_files, "sample": sample}
    log.info("ลบเกียรติบัตรที่ครบอายุแล้ว: %s", stats)
    return stats


def find_due(limit: int = 5000) -> list[dict[str, Any]]:
    """ใบที่ครบกำหนดและยังไม่ถูกลบไฟล์"""
    with connection() as conn:
        return conn.execute(
            """
            SELECT c.id, c.pdf_key, c.preview_key, c.expires_at,
                   COALESCE(s.name_en, s.name_th) AS name,
                   p.code AS program_code, e.round::text AS round, e.year
            FROM certificates c
            JOIN students s ON s.id = c.student_id
            JOIN exams e ON e.id = c.exam_id
            JOIN exam_programs p ON p.id = e.program_id
            WHERE c.expires_at IS NOT NULL
              AND c.expires_at <= NOW()
              AND c.files_deleted_at IS NULL
            ORDER BY c.expires_at
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
