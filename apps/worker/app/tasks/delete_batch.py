"""ลบรอบการนำเข้าทั้งรอบ ทั้งไฟล์บน R2 และแถวในฐานข้อมูล

เป็นงานที่ทำลายข้อมูลจริงของคนจริง จึงเขียนให้:
  - ลบไฟล์ก่อน แล้วค่อยลบแถว (key อยู่ในแถว ถ้าลบแถวก่อนจะไม่รู้ว่าต้องลบไฟล์ไหน)
  - ลบเฉพาะ key ที่ขึ้นต้นด้วย <prefix>/<batch_id>/ เท่านั้น ไม่มีทางไปโดนรอบอื่น
  - บันทึกลง deleted_batches ก่อนลบจริง เพราะแถว batches จะหายไปพร้อมกัน
  - รันซ้ำได้ ไฟล์ที่หายไปแล้วข้ามไป

ผู้เข้าสอบจะถูกลบก็ต่อเมื่อ **ไม่เหลือเกียรติบัตรและไม่มีหน้าในรอบอื่นชี้มาหา**
เงื่อนไขหลังสำคัญมาก เพราะหน้าที่แอดมินจับคู่ด้วยมือไว้ในรอบอื่นชี้มาที่ตัวคนนั้น
ถ้าลบทิ้งงานจับคู่ของรอบอื่นจะหลุดเป็นค่าว่างโดยไม่มีอะไรฟ้อง
"""

import logging
from typing import Any, Callable

from ..db import connection, new_id
from ..storage import delete_keys, list_keys

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

PREFIXES = ("certificates", "previews", "sources")


def run_delete_batch(
    batch_id: str, on_progress: ProgressFn, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    info = _load_info(batch_id)
    if info is None:
        log.info("batch %s หายไปแล้ว ไม่ต้องทำอะไร", batch_id)
        return {"alreadyGone": True}

    log.info(
        "เริ่มลบรอบนำเข้า %s (%s %s %s) — เกียรติบัตร %s ใบ",
        batch_id, info["program_code"], info["round"], info["year"], info["certificate_count"],
    )

    # 1. ไฟล์ก่อน
    files: list[dict] = []
    for prefix in PREFIXES:
        found = list_keys(f"{prefix}/{batch_id}/")
        files.extend(found)
        on_progress({"stage": "delete", "prefix": prefix, "files": len(found)})

    bytes_freed = sum(f["size"] for f in files)
    delete_keys([f["key"] for f in files])
    log.info("ลบไฟล์ %s ชิ้น (%.1f MB)", len(files), bytes_freed / 1048576)

    # 2. หาผู้เข้าสอบที่จะไม่เหลืออะไรเลยหลังลบรอบนี้
    orphans = _orphan_students(batch_id)

    # 3. บันทึกก่อนลบ แล้วลบแถว (certificates / staging_pages / jobs ตามไปด้วย cascade)
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO deleted_batches
              (id, program_code, round, year, certificate_count, student_count,
               file_count, bytes_freed, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                new_id(),
                info["program_code"],
                info["round"],
                info["year"],
                info["certificate_count"],
                len(orphans),
                len(files),
                bytes_freed,
                (payload or {}).get("note"),
            ),
        )
        conn.execute("DELETE FROM batches WHERE id = %s", (batch_id,))
        if orphans:
            conn.execute("DELETE FROM students WHERE id = ANY(%s)", (orphans,))

    stats = {
        "deletedFiles": len(files),
        "bytesFreed": bytes_freed,
        "deletedCertificates": info["certificate_count"],
        "deletedStudents": len(orphans),
    }
    log.info("ลบรอบนำเข้า %s เสร็จ: %s", batch_id, stats)
    return stats


def _load_info(batch_id: str) -> dict[str, Any] | None:
    with connection() as conn:
        return conn.execute(
            """
            SELECT p.code AS program_code, e.round::text AS round, e.year,
                   (SELECT COUNT(*) FROM certificates c WHERE c.batch_id = b.id) AS certificate_count
            FROM batches b
            JOIN exams e ON e.id = b.exam_id
            JOIN exam_programs p ON p.id = e.program_id
            WHERE b.id = %s
            """,
            (batch_id,),
        ).fetchone()


def _orphan_students(batch_id: str) -> list[str]:
    """ผู้เข้าสอบที่หลังลบรอบนี้แล้วจะไม่เหลือทั้งเกียรติบัตรและหน้าที่ชี้มาหา"""
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT c.student_id AS id
            FROM certificates c
            WHERE c.batch_id = %s
              AND NOT EXISTS (
                    SELECT 1 FROM certificates other
                    WHERE other.student_id = c.student_id AND other.batch_id <> %s)
              AND NOT EXISTS (
                    SELECT 1 FROM staging_pages sp
                    WHERE sp.matched_student_id = c.student_id AND sp.batch_id <> %s)
            """,
            (batch_id, batch_id, batch_id),
        ).fetchall()
    return [r["id"] for r in rows]
