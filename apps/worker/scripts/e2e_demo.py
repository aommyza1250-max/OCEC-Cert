"""ทดสอบทั้งสายงานด้วยไฟล์สังเคราะห์ที่เลียนโครงไฟล์จริง (ใช้ตอน dev เท่านั้น)

รันในคอนเทนเนอร์ worker:
    docker compose exec worker python scripts/e2e_demo.py

ทำตามลำดับเดียวกับที่แอดมินทำจริงทุกขั้น:
  สร้างรอบนำเข้า -> อัปโหลด ZIP -> ตั้งงาน SPLIT -> รอ
  -> อัปโหลด Excel -> ตั้งงาน MATCH -> รอ -> ตรวจผล

ถ้าอยากตรวจกับไฟล์จริง ใช้ scripts/check_real_files.py แทน
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import connection, new_id  # noqa: E402
from app.storage import upload_bytes  # noqa: E402
from tests.fixtures.builders import (  # noqa: E402
    make_award_zip,
    make_bundle_pdf,
    make_roster_xlsx,
)

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

DOMESTIC = [
    {"name": "ALPHA TESTONE", "level": "Primary 5", "cert_no": "90001"},
    {"name": "BETA TESTTWO", "level": "Primary 6", "cert_no": "90002"},
    {"name": "GAMMA TESTTHREE", "level": "Secondary 1", "cert_no": "90003"},
]
INTERNATIONAL = [
    {"name": "ALPHA TESTONE", "country": "THAILAND", "level": "Primary 5", "cert_no": "91001"},
    {"name": "TARO YAMADA", "country": "JAPAN", "level": "Primary 5", "cert_no": "91002"},
    {"name": "BETA TESTTWO", "country": "THAILAND", "level": "Primary 6", "cert_no": "91003"},
    {"name": "JOHN SMITH", "country": "UNITED STATES", "level": "Primary 6", "cert_no": "91004"},
]
# ชื่อเหมือนกันเป๊ะ — ใช้ทดสอบทั้งกรณี "คนละโรงเรียน" และ "โรงเรียนเดียวกัน"
DUPLICATE_NAMES = [
    {"name": "ALPHA TESTONE", "level": "Primary 5", "cert_no": "92001"},
    {"name": "ALPHA TESTONE", "level": "Secondary 2", "cert_no": "92002"},
]

HEADERS_WITH_SCHOOL = {
    "name_en": "Name",
    "school": "โรงเรียน",
    "cert_no": "เลขเกียรติบัตร",
    "award": "Award",
}


def main() -> int:
    # ทุกรอบใช้รหัสของตัวเอง ไม่งั้นข้อมูลจากรอบก่อนจะกลายเป็นผู้เข้าสอบชื่อพ้องที่ทำให้ผลเพี้ยน
    run = int(time.time()) % 100000
    ok = True

    ok &= run_case(
        "รอบ Heat — ตัดแยกทุกหน้า ไม่กรองสัญชาติ",
        code=f"E2EHEAT{run}",
        exam_round="HEAT",
        bundles={
            "Gold": [
                {"name": "ALPHA TESTONE", "level": "PRIMARY 5", "cert_no": "70001",
                 "award": "Gold", "round": "Heat"},
                {"name": "BETA TESTTWO", "level": "PRIMARY 6", "cert_no": "70002",
                 "award": "Gold", "round": "Heat"},
            ],
            "Merit": [
                {"name": "GAMMA TESTTHREE", "level": "SECONDARY 1", "cert_no": "70003",
                 "award": "Merit", "round": "Heat"},
            ],
        },
        roster=[
            {"cert_no": 70001, "level": "PRIMARY 5", "name_en": "ALPHA TESTONE", "award": "GOLD AWARD"},
            {"cert_no": 70002, "level": "PRIMARY 6", "name_en": "BETA TESTTWO", "award": "GOLD AWARD"},
            {"cert_no": 70003, "level": "SECONDARY 1", "name_en": "GAMMA TESTTHREE", "award": "MERIT AWARD"},
        ],
        expect_split=3,
        expect_skipped=0,
        expect_certificates=3,
    )

    ok &= run_case(
        "รอบ Final — ต้องข้ามหน้าของคนต่างชาติ",
        code=f"E2EFINAL{run}",
        exam_round="FINAL",
        bundles={
            "Silver": [
                {"name": "ALPHA TESTONE", "country": "THAILAND", "level": "PRIMARY 5",
                 "cert_no": "71001", "award": "Silver"},
                {"name": "TARO YAMADA", "country": "JAPAN", "level": "PRIMARY 5",
                 "cert_no": "71002", "award": "Silver"},
                {"name": "JOHN SMITH", "country": "UNITED STATES", "level": "PRIMARY 6",
                 "cert_no": "71003", "award": "Silver"},
            ],
            "Bronze": [
                {"name": "BETA TESTTWO", "country": "THAILAND", "level": "PRIMARY 6",
                 "cert_no": "71004", "award": "Bronze"},
            ],
        },
        roster=[
            {"cert_no": 71001, "level": "PRIMARY 5", "name_en": "ALPHA TESTONE", "award": "SILVER AWARD"},
            {"cert_no": 71004, "level": "PRIMARY 6", "name_en": "BETA TESTTWO", "award": "BRONZE AWARD"},
        ],
        expect_split=2,
        expect_skipped=2,
        expect_certificates=2,
    )

    ok &= run_case(
        "Perfect Scorer — คนเดียวได้ 2 ใบ ทั้งที่ Excel มีแถวเดียว",
        code=f"E2EPS{run}",
        exam_round="FINAL",
        bundles={
            "Gold": [
                {"name": "JAYTIPAT CHATRATANAMALAI", "country": "THAILAND", "level": "PRIMARY 3",
                 "cert_no": "72001", "award": "Gold"},
                {"name": "NAPHAT CHALOKEPUNRAT", "country": "THAILAND", "level": "PRIMARY 3",
                 "cert_no": "72002", "award": "Gold"},
            ],
            # หน้า Perfect Score ของจริงไม่มีบรรทัดรางวัล และใช้เลขเดียวกับใบ Gold ของคนเดียวกัน
            "Perfect_Score": [
                {"name": "JAYTIPAT CHATRATANAMALAI", "country": "THAILAND", "level": "PRIMARY 3",
                 "cert_no": "72001"},
            ],
        },
        roster=[
            # Excel บันทึกรางวัลสูงสุดแค่แถวเดียวต่อคน
            {"cert_no": 72001, "level": "PRIMARY 3", "name_en": "JAYTIPAT CHATRATANAMALAI",
             "award": "PERFECT SCORER"},
            {"cert_no": 72002, "level": "PRIMARY 3", "name_en": "NAPHAT CHALOKEPUNRAT",
             "award": "GOLD AWARD"},
        ],
        expect_split=3,
        expect_skipped=0,
        # 3 ใบ: Gold 2 ใบ + Perfect Score 1 ใบ โดย JAYTIPAT ได้ 2 ใบจากแถว Excel แถวเดียว
        expect_certificates=3,
        expect_students=2,
    )

    ok &= run_case(
        "ชื่อพ้องกับผู้เข้าสอบที่มีในระบบหลายคน — ต้องส่งให้แอดมิน ไม่ใช่สร้างคนใหม่",
        code=f"E2EDUP{run}",
        exam_round="HEAT",
        bundles={
            "Gold": [
                # seed มีคนชื่อนี้อยู่ 2 คน (คนละโรงเรียน) ระบบจึงแยกไม่ออกว่าเป็นคนไหน
                {"name": "SOMCHAI JAIDEE", "level": "PRIMARY 5", "cert_no": "73001",
                 "award": "Gold", "round": "Heat"},
            ],
        },
        roster=[
            {"cert_no": 73001, "level": "PRIMARY 5", "name_en": "SOMCHAI JAIDEE",
             "award": "GOLD AWARD"},
        ],
        expect_split=1,
        expect_skipped=0,
        expect_certificates=0,
        expect_matched_by_cert=0,
        expect_ambiguous=1,
    )

    print("\n" + ("ผ่านทั้งหมด ✓" if ok else "มีเคสที่ไม่ผ่าน ✗"))
    return 0 if ok else 1


def run_case(
    title: str,
    code: str,
    exam_round: str,
    bundles: dict,
    roster: list[dict],
    expect_split: int,
    expect_skipped: int,
    expect_certificates: int,
    expect_students: int | None = None,
    expect_matched_by_cert: int | None = None,
    expect_ambiguous: int = 0,
) -> bool:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")
    batch_id = create_batch(code, exam_round, title)

    zip_bytes = make_award_zip({k: make_bundle_pdf(v) for k, v in bundles.items()})
    upload_bytes(f"sources/{batch_id}/bundle.zip", zip_bytes, "application/zip")
    set_source(batch_id, "source_zip_key", f"sources/{batch_id}/bundle.zip")
    wait_for(enqueue(batch_id, "SPLIT"), "ตัดแยกหน้า")

    upload_bytes(f"sources/{batch_id}/roster.xlsx", make_roster_xlsx(roster), XLSX_MIME)
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
    for name, award, cert_no, level, pdf_key in certificates:
        print(f"  ออกเกียรติบัตร: {name} — {award} (No. {cert_no}, {level})")
        print(f"    ชื่อไฟล์: {pdf_key.rsplit('/', 1)[-1]}")

    naming_ok = all(
        f"_{code}_{exam_round}_" in pdf_key.rsplit("/", 1)[-1] for *_, pdf_key in certificates
    )
    distinct_students = len({name for name, *_ in certificates})

    checks = [
        ("จำนวนหน้าที่ตัดแยก", stats.get("pagesSplit"), expect_split),
        ("จำนวนหน้าที่ข้าม", stats.get("foreignSkipped"), expect_skipped),
        ("จำนวนเกียรติบัตรที่ออก", len(certificates), expect_certificates),
        ("ชื่อไฟล์มีรายการสอบและรอบครบ", naming_ok, True),
        ("จับคู่ด้วยเลขผู้เข้าสอบ", stats.get("matchedByCertNo"),
         expect_certificates if expect_matched_by_cert is None else expect_matched_by_cert),
        ("หน้าที่ส่งให้แอดมินตัดสิน", counts.get("AMBIGUOUS", 0), expect_ambiguous),
        ("รางวัลบนหน้าตรงกับโฟลเดอร์", stats.get("awardMismatch"), 0),
        ("จับคู่ซ้ำแล้วไม่เกิดผู้เข้าสอบเพิ่ม", students_after, students_before),
    ]
    if expect_students is not None:
        checks.append(("จำนวนผู้เข้าสอบที่ได้ใบ", distinct_students, expect_students))

    passed = True
    for label, actual, expected in checks:
        mark = "✓" if actual == expected else "✗"
        if actual != expected:
            passed = False
        print(f"  {mark} {label}: ได้ {actual} คาดหวัง {expected}")
    return passed


# ------------------------------------------------------------------ helpers

def create_batch(code: str, exam_round: str, title: str) -> str:
    program_id, exam_id, batch_id = new_id(), new_id(), new_id()
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO exam_programs (id, code, name, updated_at)
            VALUES (%s, %s, %s, NOW())
            """,
            (program_id, code, f"[E2E] {title}"),
        )
        conn.execute(
            "INSERT INTO exams (id, program_id, round, year) VALUES (%s, %s, %s, %s)",
            (exam_id, program_id, exam_round, 2026),
        )
        conn.execute(
            "INSERT INTO batches (id, exam_id, status, updated_at) VALUES (%s, %s, 'DRAFT', NOW())",
            (batch_id, exam_id),
        )
    return batch_id


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


def wait_for(job_id: str, label: str, timeout: float = 120.0) -> None:
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


def fetch_certificates(batch_id: str) -> list[tuple[str, str, str, str, str]]:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT s.name_en, c.award, c.cert_no, c.level, c.pdf_key
            FROM certificates c JOIN students s ON s.id = c.student_id
            WHERE c.batch_id = %s ORDER BY c.page_number
            """,
            (batch_id,),
        ).fetchall()
    return [(r["name_en"], r["award"], r["cert_no"], r["level"], r["pdf_key"]) for r in rows]


if __name__ == "__main__":
    raise SystemExit(main())
