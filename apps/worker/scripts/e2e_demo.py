"""ทดสอบทั้งสายงานจริงด้วยไฟล์สังเคราะห์ (ใช้ตอน dev เท่านั้น)

รันในคอนเทนเนอร์ worker:
    docker compose exec worker python scripts/e2e_demo.py

ทำตามลำดับเดียวกับที่แอดมินทำจริงทุกขั้น:
  สร้าง batch -> อัปโหลด PDF -> ตั้งงาน SPLIT -> รอ -> อัปโหลด Excel -> ตั้งงาน MATCH -> รอ -> ตรวจผล

ใช้พิสูจน์ว่าสายงานยังไม่พัง ก่อนที่จะมีไฟล์เกียรติบัตรจริงมาให้ทดสอบ
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import connection, new_id  # noqa: E402
from app.storage import upload_bytes  # noqa: E402
from tests.fixtures.builders import make_bundle_pdf, make_roster_xlsx  # noqa: E402

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

DOMESTIC = [
    {"name": "SOMCHAI JAIDEE", "level": "Primary 5", "cert_no": "90001"},
    {"name": "PIYADA SRISUK", "level": "Primary 6", "cert_no": "90002"},
    {"name": "NATTAPONG WONGTHONG", "level": "Secondary 1", "cert_no": "90003"},
]
INTERNATIONAL = [
    {"name": "SOMCHAI JAIDEE", "country": "THAILAND", "level": "Primary 5", "cert_no": "91001"},
    {"name": "TARO YAMADA", "country": "JAPAN", "level": "Primary 5", "cert_no": "91002"},
    {"name": "PIYADA SRISUK", "country": "THAILAND", "level": "Primary 6", "cert_no": "91003"},
    {"name": "JOHN SMITH", "country": "UNITED STATES", "level": "Primary 6", "cert_no": "91004"},
]
# ชื่อเหมือนกันเป๊ะ — ใช้ทดสอบทั้งกรณี "คนละโรงเรียน" และ "โรงเรียนเดียวกัน"
DUPLICATE_NAMES = [
    {"name": "SOMCHAI JAIDEE", "level": "Primary 5", "cert_no": "92001"},
    {"name": "SOMCHAI JAIDEE", "level": "Secondary 2", "cert_no": "92002"},
]

HEADERS_WITH_SCHOOL = {
    "name_en": "Name",
    "school": "โรงเรียน",
    "cert_no": "เลขเกียรติบัตร",
    "award": "Award",
}


def main() -> int:
    # ทุกรอบใช้ "รหัสรอบ" ของตัวเอง ทั้งรหัสรายการสอบและชื่อโรงเรียน
    # ไม่งั้นข้อมูลจากรอบก่อนจะกลายเป็นผู้เข้าสอบชื่อพ้องที่ทำให้รอบถัดไปตีความต่างไป
    run = int(time.time()) % 100000
    ok = True
    ok &= run_case(
        "เกียรติบัตรเฉพาะของไทย",
        code="E2EDOM",
        kind="DOMESTIC",
        entries=DOMESTIC,
        roster=[
            {"name_en": "Mr. Somchai Jaidee", "school": f"โรงเรียนสวนกุหลาบ{run}", "award": "เหรียญทอง"},
            {"name_en": "Piyada Srisuk", "school": f"รร.สตรีวิทยา{run}", "award": "เหรียญเงิน"},
            {"name_en": "Nattapong Wongthong", "school": f"โรงเรียนราชวินิต{run}", "award": "เข้าร่วม"},
        ],
        headers={"name_en": "Name", "school": "โรงเรียน", "award": "Award"},
        expect_split=3,
        expect_skipped=0,
        expect_matched=3,
    )
    ok &= run_case(
        "เกียรติบัตรรวมประเทศ (ต้องข้ามคนต่างชาติ)",
        code="E2EINT",
        kind="INTERNATIONAL",
        entries=INTERNATIONAL,
        roster=[
            {"name_en": "Somchai Jaidee", "school": f"โรงเรียนสวนกุหลาบ{run}", "award": "Gold"},
            # สลับชื่อ-นามสกุล และเขียนชื่อโรงเรียนเว้นวรรคต่างจากรอบแรก ต้องยังจับคู่ได้
            {"name_en": "Srisuk Piyada", "school": f"สตรี วิทยา{run}", "award": "Silver"},
        ],
        headers={"name_en": "Name", "school": "โรงเรียน", "award": "Award"},
        expect_split=2,
        expect_skipped=2,
        expect_matched=2,
    )
    ok &= run_case(
        "ชื่อเหมือนกันแต่คนละโรงเรียน — ต้องแยกเป็นคนละคนได้เอง",
        code="E2EDIF",
        kind="DOMESTIC",
        entries=DUPLICATE_NAMES,
        roster=[
            {"name_en": "Somchai Jaidee", "school": f"โรงเรียนสวนกุหลาบ{run}",
             "cert_no": "92001", "award": "Gold"},
            {"name_en": "Somchai Jaidee", "school": f"โรงเรียนเทพศิรินทร์{run}",
             "cert_no": "92002", "award": "Silver"},
        ],
        headers=HEADERS_WITH_SCHOOL,
        expect_split=2,
        expect_skipped=0,
        expect_matched=2,
        expect_duplicates=0,
    )
    ok &= run_case(
        "ชื่อเหมือนกันและโรงเรียนเดียวกัน — ต้องส่งให้แอดมินตัดสิน ไม่ใช่เดาเอง",
        code="E2ESAME",
        kind="DOMESTIC",
        entries=DUPLICATE_NAMES,
        roster=[
            {"name_en": "Somchai Jaidee", "school": f"โรงเรียนราชวินิตซ้ำ{run}",
             "cert_no": "92001", "award": "Gold"},
            {"name_en": "Somchai Jaidee", "school": f"โรงเรียนราชวินิตซ้ำ{run}",
             "cert_no": "92002", "award": "Silver"},
        ],
        headers=HEADERS_WITH_SCHOOL,
        expect_split=2,
        expect_skipped=0,
        # ใบแรกจับคู่ได้ ใบที่สองต้องค้างไว้ให้แอดมินดูเกียรติบัตรจริงก่อนตัดสิน
        expect_matched=1,
        expect_duplicates=1,
    )
    print("\n" + ("ผ่านทั้งหมด ✓" if ok else "มีเคสที่ไม่ผ่าน ✗"))
    return 0 if ok else 1


def run_case(
    title: str,
    code: str,
    kind: str,
    entries: list[dict],
    roster: list[dict],
    headers: dict,
    expect_split: int,
    expect_skipped: int,
    expect_matched: int,
    expect_duplicates: int = 0,
) -> bool:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")
    batch_id, exam_code = create_batch(code, kind, title)

    upload_bytes(f"sources/{batch_id}/bundle.pdf", make_bundle_pdf(entries), "application/pdf")
    set_source(batch_id, "source_pdf_key", f"sources/{batch_id}/bundle.pdf")
    wait_for(enqueue(batch_id, "SPLIT"), "ตัดแยกหน้า")

    upload_bytes(
        f"sources/{batch_id}/roster.xlsx",
        make_roster_xlsx(roster, headers=headers),
        XLSX_MIME,
    )
    set_source(batch_id, "source_excel_key", f"sources/{batch_id}/roster.xlsx")
    wait_for(enqueue(batch_id, "MATCH"), "จับคู่รายชื่อ")

    # จับคู่ซ้ำอีกรอบ — แอดมินอัปโหลด Excel ใหม่ทับได้บ่อย ต้องไม่สร้างข้อมูลซ้ำซ้อน
    students_before = count_students()
    wait_for(enqueue(batch_id, "MATCH"), "จับคู่รายชื่อรอบสอง")
    students_after = count_students()

    stats = fetch_stats(batch_id)
    counts = fetch_page_counts(batch_id)
    certificates = fetch_certificates(batch_id)

    print(f"  stats: {json.dumps(stats, ensure_ascii=False)}")
    print(f"  หน้าแยกตามสถานะ: {counts}")
    for name, school, award, cert_no, level, pdf_key in certificates:
        print(f"  ออกเกียรติบัตร: {name} [{school}] — {award} (No. {cert_no}, {level})")
        print(f"    ชื่อไฟล์: {pdf_key.rsplit('/', 1)[-1]}")

    # ชื่อไฟล์ต้องลงท้ายด้วยรหัสรายการสอบเสมอ
    naming_ok = all(
        pdf_key.rsplit("/", 1)[-1].endswith(f"_{exam_code}.pdf")
        or f"_{exam_code}_" in pdf_key.rsplit("/", 1)[-1]
        for *_, pdf_key in certificates
    )

    checks = [
        ("จำนวนหน้าที่ตัดแยก", stats.get("pagesSplit"), expect_split),
        ("จำนวนหน้าที่ข้าม", stats.get("foreignSkipped"), expect_skipped),
        ("จำนวนที่จับคู่ได้", counts.get("MATCHED", 0), expect_matched),
        ("จำนวนเกียรติบัตรที่ออก", len(certificates), expect_matched),
        ("ชื่อไฟล์ลงท้ายด้วยรหัสรายการสอบ", naming_ok, True),
        ("เก็บเลขเกียรติบัตรครบ", all(c[3] for c in certificates), True),
        ("บันทึกโรงเรียนครบ", all(c[1] for c in certificates), True),
        ("จับคู่ซ้ำแล้วไม่เกิดผู้เข้าสอบเพิ่ม", students_after, students_before),
        ("หน้าที่รอแอดมินตัดสินชื่อซ้ำ", counts.get("DUPLICATE_NAME", 0), expect_duplicates),
    ]
    passed = True
    for label, actual, expected in checks:
        mark = "✓" if actual == expected else "✗"
        if actual != expected:
            passed = False
        print(f"  {mark} {label}: ได้ {actual} คาดหวัง {expected}")
    return passed


# ------------------------------------------------------------------ helpers

def create_batch(code: str, kind: str, title: str) -> tuple[str, str]:
    program_id, exam_id, batch_id = new_id(), new_id(), new_id()
    # ต่อท้ายด้วยเวลาเพื่อให้รันซ้ำได้โดยไม่ชนกับรอบก่อน
    exam_code = f"{code}{int(time.time()) % 100000}"
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO exam_programs (id, code, name, kind, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            """,
            (program_id, exam_code, f"[E2E] {title}", kind),
        )
        conn.execute(
            "INSERT INTO exams (id, program_id, academic_year) VALUES (%s, %s, %s)",
            (exam_id, program_id, 2567),
        )
        conn.execute(
            "INSERT INTO batches (id, exam_id, status, updated_at) VALUES (%s, %s, 'DRAFT', NOW())",
            (batch_id, exam_id),
        )
    return batch_id, exam_code


def set_source(batch_id: str, column: str, key: str) -> None:
    with connection() as conn:
        conn.execute(f"UPDATE batches SET {column} = %s WHERE id = %s", (key, batch_id))


def enqueue(batch_id: str, job_type: str) -> str:
    job_id = new_id()
    with connection() as conn:
        conn.execute(
            "INSERT INTO jobs (id, type, batch_id) VALUES (%s, %s, %s)",
            (job_id, job_type, batch_id),
        )
    return job_id


def wait_for(job_id: str, label: str, timeout: float = 90.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with connection() as conn:
            row = conn.execute(
                "SELECT status, error FROM jobs WHERE id = %s", (job_id,)
            ).fetchone()
        if row["status"] == "DONE":
            print(f"  {label}: เสร็จแล้ว")
            return
        if row["status"] == "FAILED":
            raise RuntimeError(f"{label} ล้มเหลว: {row['error']}")
        time.sleep(1)
    raise TimeoutError(f"{label} ใช้เวลานานเกิน {timeout} วินาที")


def count_students() -> int:
    with connection() as conn:
        return int(conn.execute("SELECT COUNT(*) AS n FROM students").fetchone()["n"])


def fetch_stats(batch_id: str) -> dict:
    with connection() as conn:
        row = conn.execute("SELECT stats FROM batches WHERE id = %s", (batch_id,)).fetchone()
    return {k: v for k, v in row["stats"].items() if k != "unmatchedRows"}


def fetch_page_counts(batch_id: str) -> dict:
    with connection() as conn:
        rows = conn.execute(
            "SELECT match_status, COUNT(*) AS n FROM staging_pages WHERE batch_id = %s GROUP BY 1",
            (batch_id,),
        ).fetchall()
    return {r["match_status"]: r["n"] for r in rows}


def fetch_certificates(batch_id: str) -> list[tuple[str, str, str, str, str, str]]:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT s.name_en, s.school, c.award, c.cert_no, c.level, c.pdf_key
            FROM certificates c JOIN students s ON s.id = c.student_id
            WHERE c.batch_id = %s ORDER BY c.page_number
            """,
            (batch_id,),
        ).fetchall()
    return [
        (r["name_en"], r["school"], r["award"], r["cert_no"], r["level"], r["pdf_key"])
        for r in rows
    ]


if __name__ == "__main__":
    raise SystemExit(main())
