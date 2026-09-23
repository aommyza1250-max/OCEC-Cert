"""ลบไฟล์ต้นฉบับ (ZIP และ PDF ที่อัปทีละใบ) หลังจับคู่ครบและเผยแพร่แล้ว

ZIP กินที่มากที่สุด — 360 MB ต่อรอบ เทียบกับเกียรติบัตรและรูปตัวอย่างรวมกัน 210 MB
และหลังนำเข้าเสร็จแล้ว **ไม่มีอะไรในระบบเรียกใช้มันอีกเลย** ปุ่มตัดใหม่ทั้งรอบ
ก็บังคับให้อัปไฟล์ใหม่อยู่ดี ถ้าไม่ลบ พื้นที่จะโตขึ้นเรื่อย ๆ โดยไม่ได้ใช้ประโยชน์

**เก็บไฟล์รายชื่อ (.xlsx) ไว้** เพราะเล็กมาก (5 KB) และเป็นหลักฐานว่ารายชื่อแต่ละชุดมาจากไหน

เงื่อนไขก่อนลบต้องครบทุกข้อ ขาดข้อเดียวคือไม่ลบ:
  1. ผู้เข้าสอบทุกคนในรายชื่อมีเกียรติบัตรแล้ว
  2. ไม่มีหน้าที่ยังรอตัดสิน (จับคู่ไม่ได้ ชื่อ/รูปแบบไม่ตรง ชื่อพ้อง ใบซ้ำ ฯลฯ)
  3. ไม่มีใครมีแต่ใบรางวัลเสริม (เช่น Perfect Score) โดยไม่มีใบรางวัลหลัก (คนที่ยังรอไฟล์ตกหล่น)
  4. รอบนั้นเผยแพร่แล้ว

ข้อ 1 คือหัวใจ: ถ้าทุกคนในรายชื่อมีเกียรติบัตรครบ แปลว่าไม่มีคนไทยตกหล่น
หน้าที่ถูกข้ามไปตอนตัดจึงเป็นของต่างชาติจริง ๆ — ZIP ไม่เหลืออะไรที่เรายังต้องการ
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ..certificate_profiles import UnsupportedProfile, get_profile
from ..config import settings
from ..db import connection
from ..storage import delete_keys, list_keys

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

# ไฟล์รายชื่อทุกชุด (roster.xlsx ของระบบเดิม และ roster-<เวลา>.xlsx ของขั้นตอนใหม่)
KEEP_SUFFIX = ".xlsx"

# หน้าที่ยังต้องให้แอดมินตัดสิน — ZIP อาจยังต้องใช้หาไฟล์ที่ถูกต้อง
PENDING_STATUSES = (
    "UNMATCHED", "AMBIGUOUS", "DUPLICATE_NAME", "NAME_MISMATCH", "MODE_MISMATCH",
    "NATIONALITY_UNVERIFIED", "PARSE_REVIEW",
)


def run_cleanup_sources(
    batch_id: str, on_progress: ProgressFn, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    forced = bool((payload or {}).get("force"))
    blockers = check_blockers(batch_id)

    if blockers and not forced:
        log.info("ยังไม่เคลียร์ไฟล์ต้นฉบับของ batch %s: %s", batch_id, blockers)
        return {"cleared": False, "blockers": blockers}

    files = [f for f in list_keys(f"sources/{batch_id}/") if not f["key"].endswith(KEEP_SUFFIX)]
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
            """
            SELECT b.status::text AS status, b.stats, b.sources_cleared_at, b.updated_at,
                   p.code AS program_code, e.round::text AS round
            FROM batches b JOIN exams e ON e.id = b.exam_id JOIN exam_programs p ON p.id = e.program_id
            WHERE b.id = %s
            """,
            (batch_id,),
        ).fetchone()
        if batch is None:
            return ["ไม่พบรอบการนำเข้านี้"]
        if batch["sources_cleared_at"]:
            return ["เคลียร์ไปแล้ว"]

        blockers: list[str] = []

        if batch["status"] != "PUBLISHED":
            blockers.append("รอบนี้ยังไม่ได้เผยแพร่")

        missing = conn.execute(
            """
            SELECT COUNT(*) AS n FROM roster_entries re
            WHERE re.batch_id = %s
              AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.roster_entry_id = re.id)
            """,
            (batch_id,),
        ).fetchone()
        if missing["n"]:
            blockers.append(f"ยังมีผู้เข้าสอบในรายชื่อที่ไม่มีเกียรติบัตร {missing['n']} คน")

        # รอบนำเข้าจากระบบเดิม (ก่อนมีตารางรายชื่อ) นับจากสถิติของงานจับคู่ครั้งล่าสุด
        unmatched_rows = (batch["stats"] or {}).get("unmatchedRows") or []
        if unmatched_rows:
            blockers.append(f"ยังมีรายชื่อใน Excel ที่ไม่มีเกียรติบัตร {len(unmatched_rows)} คน")

        pending = conn.execute(
            """
            SELECT COUNT(*) AS n FROM staging_pages
            WHERE batch_id = %s AND match_status::text = ANY(%s)
            """,
            (batch_id, list(PENDING_STATUSES)),
        ).fetchone()
        if pending["n"]:
            blockers.append(f"ยังมีหน้าที่ต้องตัดสิน {pending['n']} หน้า")

        supplemental = _supplemental_codes(batch["program_code"], batch["round"])
        held = conn.execute(
            """
            SELECT COUNT(*) AS n FROM (
                SELECT student_id FROM certificates
                WHERE batch_id = %s
                GROUP BY student_id
                HAVING bool_or(award = ANY(%s)) AND NOT bool_or(award <> ALL(%s))
            ) held
            """,
            (batch_id, supplemental, supplemental),
        ).fetchone()
        if held["n"]:
            blockers.append(f"ยังมีคนที่มีแต่ใบรางวัลเสริมโดยไม่มีใบรางวัลหลัก {held['n']} คน")

        keep_days = settings().source_keep_days
        if keep_days and not blockers:
            published_at = batch["updated_at"]
            if published_at and published_at.tzinfo is None:
                published_at = published_at.replace(tzinfo=timezone.utc)
            ready_at = published_at + timedelta(days=keep_days)
            if datetime.now(timezone.utc) < ready_at:
                blockers.append(f"ตั้งให้รออีก {keep_days} วันหลังเผยแพร่ (ครบวันที่ {ready_at:%d/%m/%Y})")

        return blockers


def _supplemental_codes(program_code: str, exam_round: str) -> list[str]:
    """รหัสรางวัลเสริมของรายการนี้ — รอบนำเข้าจากระบบเดิมที่ไม่มีโปรไฟล์ใช้ Perfect Score อย่างเดียว"""
    try:
        catalog = get_profile(program_code, exam_round).catalog
    except UnsupportedProfile:
        return ["PERFECT_SCORE"]
    return [a.code for a in catalog.awards if a.kind == "SUPPLEMENTAL"]
