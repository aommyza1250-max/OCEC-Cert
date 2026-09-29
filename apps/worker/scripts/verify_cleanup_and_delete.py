"""ทดสอบการเคลียร์ไฟล์ต้นฉบับและการลบรอบนำเข้า กับ MinIO และฐานข้อมูลจริงในเครื่อง

    docker compose exec worker python scripts/verify_cleanup_and_delete.py

สร้างรอบนำเข้าสมมติขึ้นมาสองรอบ ทำให้ครบทั้งสายงาน แล้วตรวจว่า:
  1. ยังไม่เผยแพร่ = ยังเคลียร์ไฟล์ต้นฉบับไม่ได้
  2. เผยแพร่แล้ว = เคลียร์ได้ ZIP หาย แต่ไฟล์รายชื่อ (xlsx) และเกียรติบัตรยังอยู่
  3. ลบรอบนำเข้า = ไฟล์และแถวของรอบนั้นหายหมด
  4. **รอบอื่นไม่ถูกแตะเลย** — ข้อนี้สำคัญที่สุด ลบผิดรอบคือหายนะ
  5. บันทึกลง deleted_batches ไว้ว่าเคยมีรอบนี้อยู่

ล้างของที่สร้างขึ้นเองทั้งหมดเมื่อจบ ไม่ทิ้งขยะไว้ในฐานข้อมูล
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _intake import TestBatch, cleanup, create_batch, upload_zip, use_roster  # noqa: E402
from app.db import connection  # noqa: E402
from app.storage import list_keys  # noqa: E402
from app.tasks.cleanup_sources import check_blockers, run_cleanup_sources  # noqa: E402
from app.tasks.delete_batch import run_delete_batch  # noqa: E402
from tests.fixtures.builders import make_bundle_pdf  # noqa: E402

# สามคนนี้ใช้ทดสอบกฎการลบผู้เข้าสอบให้ครบทุกกรณี
ONLY_A = {"name": "DELTA CLEANUP", "level": "Primary 5", "cert_no": "95001", "award": "GOLD"}
IN_BOTH = {"name": "EPSILON CLEANUP", "level": "Primary 6", "cert_no": "95002", "award": "SILVER"}
LINKED_ELSEWHERE = {"name": "ZETA CLEANUP", "level": "Primary 4", "cert_no": "95003", "award": "BRONZE"}

PEOPLE = [ONLY_A, IN_BOTH, LINKED_ELSEWHERE]
PEOPLE_B = [dict(IN_BOTH, cert_no="96002")]

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✓' if ok else '✗'} {label}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


def main() -> int:
    a, b = create_batch(), create_batch()
    print(f"สร้างข้อมูลทดสอบ (HKIMO FINAL ปี {a.year} และ {b.year})")
    batch_a = build_batch(a, PEOPLE)
    batch_b = build_batch(b, PEOPLE_B)  # รอบอื่น ไว้ตรวจว่าไม่ถูกแตะ
    # จำลองงานจับคู่ด้วยมือในรอบอื่นที่ชี้มาที่ ZETA โดยไม่มีเกียรติบัตร
    # ถ้าลบคนนี้ทิ้ง งานจับคู่ของรอบนั้นจะหลุดเป็นค่าว่างโดยไม่มีอะไรฟ้อง
    link_page_to_student(batch_b, student_id("ZETA CLEANUP"))

    try:
        print("\n1. ยังไม่เผยแพร่ ต้องยังเคลียร์ไฟล์ต้นฉบับไม่ได้")
        blockers = check_blockers(batch_a)
        check("มีเหตุผลกันไว้", bool(blockers), ", ".join(blockers))
        check("เหตุผลคือยังไม่เผยแพร่", any("เผยแพร่" in b for b in blockers))
        run_cleanup_sources(batch_a, lambda _: None)
        check("ZIP ยังอยู่", any(k["key"].endswith(".zip") for k in list_keys(f"sources/{batch_a}/")))

        print("\n2. เผยแพร่แล้ว ต้องเคลียร์ได้")
        publish(batch_a)
        check("ไม่เหลือเหตุผลกัน", check_blockers(batch_a) == [], str(check_blockers(batch_a)))
        run_cleanup_sources(batch_a, lambda _: None)
        sources = [k["key"] for k in list_keys(f"sources/{batch_a}/")]
        check("ZIP ถูกลบแล้ว", not any(k.endswith(".zip") for k in sources))
        check("ไฟล์รายชื่อยังอยู่", any(k.endswith(".xlsx") for k in sources))
        check("เกียรติบัตรยังอยู่ครบ", len(list_keys(f"certificates/{batch_a}/")) == len(PEOPLE))
        check("รูปตัวอย่างยังอยู่ครบ", len(list_keys(f"previews/{batch_a}/")) == len(PEOPLE))
        check("บันทึกเวลาเคลียร์ไว้", cleared_at(batch_a) is not None)

        print("\n3. ลบรอบนำเข้า")
        before_students = count_students()
        stats = run_delete_batch(batch_a, lambda _: None, {"note": "ทดสอบ"})
        check("ลบไฟล์ครบทั้ง 3 โฟลเดอร์", stats["deletedFiles"] >= len(PEOPLE) * 2)
        for prefix in ("certificates", "previews", "sources"):
            check(f"ไม่เหลือไฟล์ใน {prefix}/", list_keys(f"{prefix}/{batch_a}/") == [])
        check("แถวรอบนำเข้าหายไป", not batch_exists(batch_a))
        check("เกียรติบัตรหายตามไปด้วย", count_certificates(batch_a) == 0)
        check("ลบเฉพาะคนที่ไม่เหลืออะไรเลย 1 คน", count_students() == before_students - 1,
              f"{before_students} -> {count_students()}")
        check("คนที่มีใบในรอบอื่น ไม่ถูกลบ", student_id("EPSILON CLEANUP") is not None)
        check("คนที่มีหน้าในรอบอื่นชี้มาหา ไม่ถูกลบ", student_id("ZETA CLEANUP") is not None)
        check("คนที่ไม่เหลืออะไรเลย ถูกลบ", student_id("DELTA CLEANUP") is None)
        check("บันทึกลง deleted_batches", deleted_record("HKIMO", a.year) is not None)

        print("\n4. รอบอื่นต้องไม่ถูกแตะเลย")
        check("ไฟล์เกียรติบัตรยังครบ", len(list_keys(f"certificates/{batch_b}/")) == len(PEOPLE_B))
        check("ไฟล์ต้นฉบับยังอยู่", any(k["key"].endswith(".zip") for k in list_keys(f"sources/{batch_b}/")))
        check("แถวรอบนำเข้ายังอยู่", batch_exists(batch_b))
        check("เกียรติบัตรยังอยู่", count_certificates(batch_b) == len(PEOPLE_B))
        check("งานจับคู่ด้วยมือในรอบอื่นไม่หลุด", linked_pages(batch_b) > 0)
    finally:
        cleanup([a, b], "CLEANUP")

    print()
    if failures:
        print(f"ไม่ผ่าน {len(failures)} ข้อ: {failures}")
        return 1
    print("ผ่านทุกข้อ")
    return 0


def build_batch(target: TestBatch, people: list[dict]) -> str:
    """รายชื่อ -> ใช้รายชื่อ -> ZIP (โฟลเดอร์ online/<รางวัล>) -> จับคู่ ตามขั้นตอนจริง"""
    entries = [dict(p, country="THAILAND", year=target.year) for p in people]
    use_roster(target.batch_id, entries)
    upload_zip(target.batch_id, {f"online/{p['award']}/{p['cert_no']}.pdf": make_bundle_pdf([p]) for p in entries})
    return target.batch_id


def student_id(name_en: str):
    with connection() as conn:
        row = conn.execute("SELECT id FROM students WHERE name_en = %s", (name_en,)).fetchone()
    return row["id"] if row else None


def link_page_to_student(batch_id: str, student: str) -> None:
    """ผูกหน้าหนึ่งในรอบนั้นกับผู้เข้าสอบ เลียนแบบการจับคู่ด้วยมือของแอดมิน"""
    with connection() as conn:
        conn.execute(
            """
            UPDATE staging_pages SET matched_student_id = %s, matched_manually = true
            WHERE id = (SELECT id FROM staging_pages WHERE batch_id = %s ORDER BY page_number LIMIT 1)
            """,
            (student, batch_id),
        )


def linked_pages(batch_id: str) -> int:
    with connection() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM staging_pages WHERE batch_id = %s AND matched_student_id IS NOT NULL",
            (batch_id,),
        ).fetchone()["n"]


def publish(batch_id: str) -> None:
    with connection() as conn:
        conn.execute("UPDATE certificates SET published_at = NOW() WHERE batch_id = %s", (batch_id,))
        conn.execute("UPDATE batches SET status = 'PUBLISHED' WHERE id = %s", (batch_id,))


def cleared_at(batch_id: str):
    with connection() as conn:
        row = conn.execute("SELECT sources_cleared_at FROM batches WHERE id = %s", (batch_id,)).fetchone()
    return row["sources_cleared_at"] if row else None


def batch_exists(batch_id: str) -> bool:
    with connection() as conn:
        return conn.execute("SELECT 1 FROM batches WHERE id = %s", (batch_id,)).fetchone() is not None


def count_certificates(batch_id: str) -> int:
    with connection() as conn:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM certificates WHERE batch_id = %s", (batch_id,)
        ).fetchone()["n"]


def count_students() -> int:
    with connection() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM students").fetchone()["n"]


def deleted_record(code: str, year: int):
    with connection() as conn:
        return conn.execute(
            "SELECT * FROM deleted_batches WHERE program_code = %s AND year = %s", (code, year)
        ).fetchone()


if __name__ == "__main__":
    raise SystemExit(main())
