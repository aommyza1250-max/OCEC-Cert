"""ลบไฟล์ต้นฉบับ (ZIP และ PDF ที่อัปทีละใบ) หลังจับคู่ครบและเผยแพร่แล้ว

ZIP กินที่มากที่สุด — 360 MB ต่อรอบ เทียบกับเกียรติบัตรและรูปตัวอย่างรวมกัน 210 MB
และหลังนำเข้าเสร็จแล้ว **ไม่มีอะไรในระบบเรียกใช้มันอีกเลย** ปุ่มตัดใหม่ทั้งรอบ
ก็บังคับให้อัปไฟล์ใหม่อยู่ดี ถ้าไม่ลบ พื้นที่จะโตขึ้นเรื่อย ๆ โดยไม่ได้ใช้ประโยชน์

**เก็บ roster.xlsx ไว้** เพราะเล็กมาก (5 KB) และใช้จับคู่ใหม่ได้โดยไม่ต้องขอไฟล์จากต้นทาง

เงื่อนไขก่อนลบต้องครบทุกข้อ ขาดข้อเดียวคือไม่ลบ:
  1. ทุกแถวในชีทรายชื่อจับคู่ได้หมด
  2. ไม่มีหน้าค้างสถานะ UNMATCHED / AMBIGUOUS / DUPLICATE_NAME
  3. ไม่มีใครมีใบ Perfect Score แต่ไม่มีใบเหรียญ (คนที่ยังรอไฟล์ตกหล่น)
  4. รอบนั้นเผยแพร่แล้ว

ข้อ 1 คือหัวใจ: ถ้าทุกคนในชีทมีเกียรติบัตรครบ แปลว่าไม่มีคนไทยตกหล่น
หน้าที่ถูกข้ามไปตอนตัดจึงเป็นของต่างชาติจริง ๆ — ZIP ไม่เหลืออะไรที่เรายังต้องการ
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ..config import settings
from ..db import connection
from ..storage import delete_keys, list_keys

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

KEEP_FILENAME = "roster.xlsx"


def run_cleanup_sources(
    batch_id: str, on_progress: ProgressFn, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    forced = bool((payload or {}).get("force"))
    blockers = check_blockers(batch_id)

    if blockers and not forced:
        log.info("ยังไม่เคลียร์ไฟล์ต้นฉบับของ batch %s: %s", batch_id, blockers)
        return {"cleared": False, "blockers": blockers}

    files = [f for f in list_keys(f"sources/{batch_id}/") if not f["key"].endswith(KEEP_FILENAME)]
    bytes_freed = sum(f["size"] for f in files)
    delete_keys([f["key"] for f in files])

    with connection() as conn:
        conn.execute(
            """
            UPDATE batches
            SET sources_cleared_at = NOW(), source_zip_key = NULL, updated_at = NOW()
            WHERE id = %s
            """,
            (batch_id,),
        )

    stats = {"cleared": True, "deletedFiles": len(files), "bytesFreed": bytes_freed}
    log.info("เคลียร์ไฟล์ต้นฉบับ batch %s: %s ชิ้น (%.1f MB)",
             batch_id, len(files), bytes_freed / 1048576)
    return stats


def check_blockers(batch_id: str) -> list[str]:
    """คืนรายการเหตุผลที่ยังลบไม่ได้ — ว่างเปล่าแปลว่าลบได้

    ข้อความในลิสต์เอาไปแสดงบนหน้าแอดมินได้ตรง ๆ
    """
    with connection() as conn:
        batch = conn.execute(
            "SELECT status::text AS status, stats, sources_cleared_at, updated_at FROM batches WHERE id = %s",
            (batch_id,),
        ).fetchone()
        if batch is None:
            return ["ไม่พบรอบการนำเข้านี้"]
        if batch["sources_cleared_at"]:
            return ["เคลียร์ไปแล้ว"]

        blockers: list[str] = []

        if batch["status"] != "PUBLISHED":
            blockers.append("รอบนี้ยังไม่ได้เผยแพร่")

        unmatched_rows = (batch["stats"] or {}).get("unmatchedRows") or []
        if unmatched_rows:
            blockers.append(f"ยังมีรายชื่อใน Excel ที่ไม่มีเกียรติบัตร {len(unmatched_rows)} คน")

        pending = conn.execute(
            """
            SELECT COUNT(*) AS n FROM staging_pages
            WHERE batch_id = %s AND match_status IN ('UNMATCHED', 'AMBIGUOUS', 'DUPLICATE_NAME')
            """,
            (batch_id,),
        ).fetchone()
        if pending["n"]:
            blockers.append(f"ยังมีหน้าที่ต้องตัดสิน {pending['n']} หน้า")

        held = conn.execute(
            """
            SELECT COUNT(*) AS n FROM (
                SELECT student_id FROM certificates
                WHERE batch_id = %s
                GROUP BY student_id
                HAVING bool_or(award = 'PERFECT_SCORE') AND NOT bool_or(award <> 'PERFECT_SCORE')
            ) held
            """,
            (batch_id,),
        ).fetchone()
        if held["n"]:
            blockers.append(f"ยังมีคนที่มีใบคะแนนเต็มแต่ไม่มีใบเหรียญ {held['n']} คน")

        keep_days = settings().source_keep_days
        if keep_days and not blockers:
            published_at = batch["updated_at"]
            if published_at and published_at.tzinfo is None:
                published_at = published_at.replace(tzinfo=timezone.utc)
            ready_at = published_at + timedelta(days=keep_days)
            if datetime.now(timezone.utc) < ready_at:
                blockers.append(f"ตั้งให้รออีก {keep_days} วันหลังเผยแพร่ (ครบวันที่ {ready_at:%d/%m/%Y})")

        return blockers
