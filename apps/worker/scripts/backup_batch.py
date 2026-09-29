"""สำรองข้อมูลของรอบนำเข้าก่อนล้างแล้วนำเข้าใหม่ — อ่านอย่างเดียว ไม่แก้และไม่ลบอะไรเลย

    docker compose exec worker python scripts/backup_batch.py --list
    docker compose exec worker python scripts/backup_batch.py <batch id>
    docker compose exec worker python scripts/backup_batch.py <batch id> --with-files

ได้โฟลเดอร์ tmp/backups/<รายการ>_<รอบ>_<ปี>_<เวลา>/ (อยู่ใต้ apps/worker/tmp ซึ่ง git ไม่เก็บ):
  - rows.json      แถวทั้งหมดของรอบนี้ในฐานข้อมูล (รอบนำเข้า รายชื่อ หน้า เกียรติบัตร ผู้เข้าสอบ งาน บันทึกการแก้ไข)
  - objects.json   รายการไฟล์บน R2 ใต้ certificates/ previews/ sources/ ของรอบนี้ พร้อมขนาด
  - summary.txt    ยอดสรุปไว้เทียบหลังนำเข้าใหม่
  - files/         สำเนาไฟล์จริงจาก R2 (เฉพาะเมื่อสั่ง --with-files) ดาวน์โหลดลงดิสก์ทีละไฟล์

⚠️ ผลลัพธ์มีชื่อและเกียรติบัตรของคนจริง = ข้อมูลส่วนบุคคล
   ห้าม commit และควรย้ายไปเก็บที่ปลอดภัยแล้วลบออกจากเครื่องที่ใช้ทำงานเมื่อไม่ใช้แล้ว

ขั้นตอนทั้งหมด (สำรอง → ล้าง → นำเข้าใหม่) ดู docs/runbook.md หัวข้อ "นำข้อมูลชุดเดิมเข้าใหม่ตามขั้นตอนใหม่"
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import connection  # noqa: E402
from app.storage import download_to_file, list_keys  # noqa: E402

PREFIXES = ("certificates", "previews", "sources")
OUT_ROOT = Path(__file__).resolve().parents[1] / "tmp" / "backups"

# แต่ละตาราง: คำสั่งดึงเฉพาะแถวที่เกี่ยวกับรอบนี้ (%(b)s = batch id)
QUERIES: dict[str, str] = {
    "batch": "SELECT * FROM batches WHERE id = %(b)s",
    "exam": "SELECT e.* FROM exams e JOIN batches b ON b.exam_id = e.id WHERE b.id = %(b)s",
    "program": """SELECT p.* FROM exam_programs p JOIN exams e ON e.program_id = p.id
                  JOIN batches b ON b.exam_id = e.id WHERE b.id = %(b)s""",
    "roster_imports": "SELECT * FROM roster_imports WHERE batch_id = %(b)s ORDER BY uploaded_at",
    "roster_import_rows": """SELECT r.* FROM roster_import_rows r
                             JOIN roster_imports i ON i.id = r.import_id
                             WHERE i.batch_id = %(b)s ORDER BY i.uploaded_at, r.row_number""",
    "roster_entries": "SELECT * FROM roster_entries WHERE batch_id = %(b)s ORDER BY candidate_no",
    "staging_pages": "SELECT * FROM staging_pages WHERE batch_id = %(b)s ORDER BY page_number",
    "certificates": "SELECT * FROM certificates WHERE batch_id = %(b)s ORDER BY created_at",
    # ผู้เข้าสอบที่รอบนี้อ้างถึง (ตัวคนใช้ร่วมกับรอบอื่นได้ จึงเก็บไว้ทั้งแถว)
    "students": """SELECT * FROM students WHERE id IN (
                     SELECT student_id FROM certificates WHERE batch_id = %(b)s
                     UNION SELECT matched_student_id FROM staging_pages WHERE batch_id = %(b)s
                     UNION SELECT student_id FROM roster_entries WHERE batch_id = %(b)s)
                   ORDER BY id""",
    "jobs": "SELECT * FROM jobs WHERE batch_id = %(b)s ORDER BY created_at",
    "audit_events": "SELECT * FROM audit_events WHERE batch_id = %(b)s ORDER BY created_at",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="สำรองข้อมูลของรอบนำเข้า (อ่านอย่างเดียว)")
    parser.add_argument("batch_id", nargs="?", help="id ของรอบนำเข้า (ดูได้จาก --list)")
    parser.add_argument("--list", action="store_true", help="แสดงรอบนำเข้าทั้งหมดแล้วจบ")
    parser.add_argument("--with-files", action="store_true", help="ดาวน์โหลดไฟล์จริงจาก R2 มาด้วย")
    args = parser.parse_args()

    if args.list or not args.batch_id:
        _print_batches()
        return 0 if args.list else 2

    rows = _load_rows(args.batch_id)
    if not rows["batch"]:
        print(f"ไม่พบรอบนำเข้า {args.batch_id}")
        return 1
    exam, program = rows["exam"][0], rows["program"][0]

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out = OUT_ROOT / f"{program['code']}_{exam['round']}_{exam['year']}_{stamp}"
    out.mkdir(parents=True)

    objects = [o for prefix in PREFIXES for o in list_keys(f"{prefix}/{args.batch_id}/")]
    referenced = _referenced_keys(rows)
    listed = {o["key"] for o in objects}
    missing = sorted(referenced - listed)

    (out / "rows.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1, default=_json_default), encoding="utf-8"
    )
    (out / "objects.json").write_text(
        json.dumps({"objects": objects, "referencedButMissing": missing}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    if args.with_files:
        for index, obj in enumerate(objects, 1):
            target = out / "files" / obj["key"]
            target.parent.mkdir(parents=True, exist_ok=True)
            download_to_file(obj["key"], str(target))
            if index % 100 == 0 or index == len(objects):
                print(f"  ดาวน์โหลดแล้ว {index}/{len(objects)} ไฟล์")

    summary = _summary(rows, objects, missing, args.with_files)
    (out / "summary.txt").write_text(summary, encoding="utf-8")
    print(summary)
    print(f"\nบันทึกไว้ที่ {out}")
    print("⚠️ มีข้อมูลส่วนบุคคล — ห้าม commit ย้ายไปเก็บที่ปลอดภัยแล้วลบออกจากเครื่องนี้")
    return 0


def _print_batches() -> None:
    with connection() as conn:
        batches = conn.execute(
            """
            SELECT b.id, p.code, e.round::text AS round, e.year, b.status::text AS status,
                   b.profile_key, (SELECT COUNT(*) FROM certificates c WHERE c.batch_id = b.id) AS certs
            FROM batches b JOIN exams e ON e.id = b.exam_id JOIN exam_programs p ON p.id = e.program_id
            ORDER BY e.year DESC, p.code, e.round
            """
        ).fetchall()
    if not batches:
        print("ยังไม่มีรอบนำเข้า")
    for b in batches:
        kind = "ขั้นตอนใหม่" if b["profile_key"] else "ระบบเดิม"
        print(f"{b['id']}  {b['code']} {b['round']} {b['year']}  {b['status']}  "
              f"เกียรติบัตร {b['certs']} ใบ  ({kind})")


def _load_rows(batch_id: str) -> dict[str, list[dict[str, Any]]]:
    # อ่านทุกตารางใน transaction เดียว ยอดทุกไฟล์จึงเป็นภาพเดียวกัน แม้ worker จะทำงานอยู่
    with connection() as conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        return {name: conn.execute(sql, {"b": batch_id}).fetchall() for name, sql in QUERIES.items()}


def _referenced_keys(rows: dict[str, list[dict[str, Any]]]) -> set[str]:
    """key ที่ฐานข้อมูลชี้ถึง — ใช้ตรวจว่ามีไฟล์ที่ควรอยู่แต่หายไปจาก R2 หรือไม่"""
    keys: set[str] = set()
    for page in rows["staging_pages"]:
        keys.update(k for k in (page.get("pdf_key"), page.get("preview_key")) if k)
    for cert in rows["certificates"]:
        if cert.get("files_deleted_at") is None:
            keys.update(k for k in (cert.get("pdf_key"), cert.get("preview_key")) if k)
    return keys


def _summary(
    rows: dict[str, list[dict[str, Any]]], objects: list[dict], missing: list[str], with_files: bool
) -> str:
    batch, exam, program = rows["batch"][0], rows["exam"][0], rows["program"][0]
    entries = rows["roster_entries"]
    certs = rows["certificates"]
    by_award: dict[str, int] = {}
    for cert in certs:
        by_award[cert["award"]] = by_award.get(cert["award"], 0) + 1
    by_prefix: dict[str, tuple[int, int]] = {}
    for obj in objects:
        prefix = obj["key"].split("/", 1)[0]
        count, size = by_prefix.get(prefix, (0, 0))
        by_prefix[prefix] = (count + 1, size + obj["size"])

    lines = [
        f"รอบนำเข้า: {program['code']} {exam['round']} {exam['year']} ({batch['id']})",
        f"สถานะ: {batch['status']}  โปรไฟล์: {batch.get('profile_key') or '(ระบบเดิม)'}",
        f"สำรองเมื่อ: {datetime.now(UTC).isoformat(timespec='seconds')}",
        "",
        (f"รายชื่อ: {len(entries)} คน (online {sum(e['exam_mode'] == 'ONLINE' for e in entries)}, "
         f"onsite {sum(e['exam_mode'] == 'ONSITE' for e in entries)})"),
        f"หน้าที่ตัดแล้ว: {len(rows['staging_pages'])} หน้า",
        f"เกียรติบัตร: {len(certs)} ใบ  เผยแพร่อยู่ {sum(c['published_at'] is not None for c in certs)} ใบ",
        "  " + ", ".join(f"{award} {n}" for award, n in sorted(by_award.items())),
        f"ผู้เข้าสอบที่อ้างถึง: {len(rows['students'])} คน",
        f"บันทึกการแก้ไข: {len(rows['audit_events'])} รายการ",
        "",
        "ไฟล์บน R2:",
        *(f"  {p}/: {n} ไฟล์ {size / 1_048_576:.1f} MB" for p, (n, size) in sorted(by_prefix.items())),
        f"  ฐานข้อมูลอ้างถึงแต่ไม่พบบน R2: {len(missing)} ไฟล์",
        f"  ดาวน์โหลดไฟล์จริงมาด้วย: {'ใช่' if with_files else 'ไม่ (สั่ง --with-files ถ้าต้องการ)'}",
    ]
    return "\n".join(lines)


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    if isinstance(value, (bytes, memoryview)):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    raise TypeError(f"แปลงเป็น JSON ไม่ได้: {type(value).__name__}")


if __name__ == "__main__":
    sys.exit(main())
