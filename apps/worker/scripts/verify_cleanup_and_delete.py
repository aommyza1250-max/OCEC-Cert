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

from app.db import connection, new_id  # noqa: E402
from app.storage import list_keys, upload_bytes  # noqa: E402
from app.tasks.cleanup_sources import check_blockers, run_cleanup_sources  # noqa: E402
from app.tasks.delete_batch import run_delete_batch  # noqa: E402
from app.tasks.match_excel import run_match  # noqa: E402
from app.tasks.split import run_split  # noqa: E402
from tests.fixtures.builders import make_award_zip, make_bundle_pdf, make_roster_xlsx  # noqa: E402

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

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
    code = f"E2ECLEAN{new_id()[:6].upper()}"
    print(f"สร้างข้อมูลทดสอบ (รายการสอบ {code})")
    batch_a = build_batch(code, 2026, PEOPLE)
    batch_b = build_batch(code, 2025, PEOPLE_B)  # รอบอื่น ไว้ตรวจว่าไม่ถูกแตะ
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
        check("ไฟล์รายชื่อยังอยู่", any(k.endswith("roster.xlsx") for k in sources))
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
        check("บันทึกลง deleted_batches", deleted_record(code, 2026) is not None)

        print("\n4. รอบอื่นต้องไม่ถูกแตะเลย")
        check("ไฟล์เกียรติบัตรยังครบ", len(list_keys(f"certificates/{batch_b}/")) == len(PEOPLE_B))
        check("ไฟล์ต้นฉบับยังอยู่", any(k["key"].endswith(".zip") for k in list_keys(f"sources/{batch_b}/")))
        check("แถวรอบนำเข้ายังอยู่", batch_exists(batch_b))
        check("เกียรติบัตรยังอยู่", count_certificates(batch_b) == len(PEOPLE_B))
        check("งานจับคู่ด้วยมือในรอบอื่นไม่หลุด", linked_pages(batch_b) > 0)
    finally:
        cleanup(code, [batch_a, batch_b])

    print()
    if failures:
        print(f"ไม่ผ่าน {len(failures)} ข้อ: {failures}")
        return 1
    print("ผ่านทุกข้อ")
    return 0


def build_batch(code: str, year: int, people: list[dict]) -> str:
    with connection() as conn:
        program = conn.execute(
            """
            INSERT INTO exam_programs (id, code, name, updated_at) VALUES (%s, %s, %s, NOW())
            ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
            """,
            (new_id(), code, f"ทดสอบ {code}"),
        ).fetchone()["id"]
        exam = conn.execute(
            "INSERT INTO exams (id, program_id, round, year) VALUES (%s, %s, 'FINAL', %s) RETURNING id",
            (new_id(), program, year),
        ).fetchone()["id"]
        batch_id = conn.execute(
            "INSERT INTO batches (id, exam_id, status, updated_at) VALUES (%s, %s, 'DRAFT', NOW()) RETURNING id",
            (new_id(), exam),
        ).fetchone()["id"]

    entries = [dict(p, country="THAILAND", year=year) for p in people]
    zip_key = f"sources/{batch_id}/bundle-test.zip"
    upload_bytes(zip_key, make_award_zip({p["award"]: make_bundle_pdf([p]) for p in entries}),
                 "application/zip")
    upload_bytes(f"sources/{batch_id}/roster.xlsx",
                 make_roster_xlsx([{"cert_no": p["cert_no"], "name_en": p["name"],
                                    "level": p["level"], "award": p["award"]} for p in entries]),
                 XLSX_MIME)

    with connection() as conn:
        conn.execute(
            "UPDATE batches SET source_zip_key = %s, source_excel_key = %s WHERE id = %s",
            (zip_key, f"sources/{batch_id}/roster.xlsx", batch_id),
        )

    run_split(batch_id, lambda _: None, {"zipKey": zip_key})
    run_match(batch_id, lambda _: None)
    return batch_id


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


def cleanup(code: str, batch_ids: list[str]) -> None:
    from app.storage import delete_keys

    for batch_id in batch_ids:
        for prefix in ("certificates", "previews", "sources"):
            delete_keys([k["key"] for k in list_keys(f"{prefix}/{batch_id}/")])
    with connection() as conn:
        conn.execute("DELETE FROM deleted_batches WHERE program_code = %s", (code,))
        conn.execute(
            """
            DELETE FROM students WHERE id IN (
                SELECT s.id FROM students s
                LEFT JOIN certificates c ON c.student_id = s.id
                WHERE c.id IS NULL AND s.name_en LIKE '%CLEANUP')
            """,
        )
        conn.execute("DELETE FROM batches WHERE id = ANY(%s)", (batch_ids,))
        conn.execute(
            "DELETE FROM exams WHERE program_id IN (SELECT id FROM exam_programs WHERE code = %s)",
            (code,),
        )
        conn.execute("DELETE FROM exam_programs WHERE code = %s", (code,))
    print("\n(ล้างข้อมูลทดสอบเรียบร้อย)")


if __name__ == "__main__":
    raise SystemExit(main())
