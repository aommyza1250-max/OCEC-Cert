"""ทดสอบการลบเกียรติบัตรที่ครบอายุการเก็บ กับ MinIO และฐานข้อมูลจริงในเครื่อง

    docker compose exec worker python scripts/verify_expire.py

สร้างรอบนำเข้าสมมติ เผยแพร่ แล้วบิดวันหมดอายุให้เป็นอดีต จากนั้นตรวจว่า:
  1. ปิดสวิตช์อยู่ = ไม่ลบอะไรเลย แม้จะครบกำหนดแล้ว
  2. dry-run = บอกว่าจะลบอะไร แต่ไฟล์ยังอยู่ครบ
  3. เปิดสวิตช์ = ลบไฟล์จริง แถวยังอยู่ และหน้าค้นหาจะกรองออกให้เอง
  4. ใบที่ยังไม่เผยแพร่ (ไม่มีวันหมดอายุ) ต้องไม่ถูกแตะเลย
"""

import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config  # noqa: E402
from app.db import connection, new_id  # noqa: E402
from app.storage import list_keys, upload_bytes  # noqa: E402
from app.tasks import expire  # noqa: E402
from app.tasks.match_excel import run_match  # noqa: E402
from app.tasks.split import run_split  # noqa: E402
from tests.fixtures.builders import make_award_zip, make_bundle_pdf, make_roster_xlsx  # noqa: E402

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PEOPLE = [
    {"name": "OMEGA EXPIRED", "level": "Primary 5", "cert_no": "97001", "award": "GOLD"},
    {"name": "SIGMA EXPIRED", "level": "Primary 6", "cert_no": "97002", "award": "SILVER"},
]

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✓' if ok else '✗'} {label}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


_BASE = config.settings()


def set_enabled(value: bool) -> None:
    """สลับสวิตช์ในเทส โดยไม่ต้องตั้ง environment แล้วรีสตาร์ท worker

    Settings เป็น dataclass แบบ frozen จึงสร้างตัวใหม่แทนการแก้ของเดิม
    แล้วสลับเฉพาะตัวที่ expire.py มองเห็น ไม่ไปแตะของส่วนอื่น
    """
    patched = replace(_BASE, retention_enabled=value)
    expire.settings = lambda: patched  # type: ignore[assignment]


def main() -> int:
    code = f"E2EEXP{new_id()[:6].upper()}"
    print(f"สร้างข้อมูลทดสอบ (รายการสอบ {code})")
    batch_id = build_batch(code, 2024)
    keep_id = build_batch(code, 2023)  # รอบที่ยังไม่เผยแพร่ ไว้ตรวจว่าไม่ถูกแตะ

    try:
        publish_and_backdate(batch_id)
        print("\n1. ปิดสวิตช์อยู่ ต้องไม่ลบอะไร")
        set_enabled(False)
        stats = expire.run_expire(None, lambda _: None, {})
        check("บอกว่าครบกำหนด 2 ใบ", stats["due"] == len(PEOPLE), str(stats["due"]))
        check("ไม่ได้ลบอะไร", stats["deletedCertificates"] == 0)
        check("บอกเหตุผลว่าปิดสวิตช์อยู่", "RETENTION_ENABLED" in str(stats.get("reason")))
        check("ไฟล์ยังอยู่ครบ", len(list_keys(f"certificates/{batch_id}/")) == len(PEOPLE))

        print("\n2. dry-run ต้องบอกรายการแต่ไม่ลบ")
        set_enabled(True)
        stats = expire.run_expire(None, lambda _: None, {"dryRun": True})
        check("บอกรายชื่อตัวอย่าง", bool(stats.get("sample")), str(stats.get("sample"))[:60])
        check("ไฟล์ยังอยู่ครบ", len(list_keys(f"certificates/{batch_id}/")) == len(PEOPLE))
        check("ยังไม่มีใบไหนถูกทำเครื่องหมายว่าลบแล้ว", deleted_count(batch_id) == 0)

        print("\n3. เปิดสวิตช์ ต้องลบไฟล์จริง")
        stats = expire.run_expire(None, lambda _: None, {})
        check("ลบครบทุกใบ", stats["deletedCertificates"] == len(PEOPLE))
        check("ไฟล์เกียรติบัตรหายหมด", list_keys(f"certificates/{batch_id}/") == [])
        check("รูปตัวอย่างหายหมด", list_keys(f"previews/{batch_id}/") == [])
        check("แถวยังอยู่ (ยังรู้ว่าเคยออกใบให้ใคร)", certificate_count(batch_id) == len(PEOPLE))
        check("ทำเครื่องหมายว่าลบไฟล์แล้วครบ", deleted_count(batch_id) == len(PEOPLE))
        check("หน้าค้นหาจะไม่เห็นแล้ว", searchable_count(batch_id) == 0)
        check("รันซ้ำไม่มีอะไรให้ทำแล้ว", expire.run_expire(None, lambda _: None, {})["due"] == 0)

        print("\n4. รอบที่ยังไม่เผยแพร่ต้องไม่ถูกแตะ")
        check("ไฟล์ยังอยู่ครบ", len(list_keys(f"certificates/{keep_id}/")) == len(PEOPLE))
        check("ไม่มีวันหมดอายุ", expires_count(keep_id) == 0)
    finally:
        cleanup(code, [batch_id, keep_id])

    print()
    if failures:
        print(f"ไม่ผ่าน {len(failures)} ข้อ: {failures}")
        return 1
    print("ผ่านทุกข้อ")
    return 0


def build_batch(code: str, year: int) -> str:
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

    entries = [dict(p, country="THAILAND", year=year) for p in PEOPLE]
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


def publish_and_backdate(batch_id: str) -> None:
    """เผยแพร่แล้วบิดวันหมดอายุให้เป็นเมื่อวาน เพื่อจำลองว่าครบ 2 ปีแล้ว"""
    with connection() as conn:
        conn.execute(
            """
            UPDATE certificates
            SET published_at = NOW() - INTERVAL '2 years',
                expires_at = NOW() - INTERVAL '1 day'
            WHERE batch_id = %s
            """,
            (batch_id,),
        )
        conn.execute("UPDATE batches SET status = 'PUBLISHED' WHERE id = %s", (batch_id,))


def certificate_count(batch_id: str) -> int:
    return _scalar("SELECT COUNT(*) AS n FROM certificates WHERE batch_id = %s", batch_id)


def deleted_count(batch_id: str) -> int:
    return _scalar(
        "SELECT COUNT(*) AS n FROM certificates WHERE batch_id = %s AND files_deleted_at IS NOT NULL",
        batch_id,
    )


def expires_count(batch_id: str) -> int:
    return _scalar(
        "SELECT COUNT(*) AS n FROM certificates WHERE batch_id = %s AND expires_at IS NOT NULL",
        batch_id,
    )


def searchable_count(batch_id: str) -> int:
    """นับแบบเดียวกับที่หน้าค้นหาใช้ — เผยแพร่แล้วและไฟล์ยังอยู่"""
    return _scalar(
        """
        SELECT COUNT(*) AS n FROM certificates
        WHERE batch_id = %s AND published_at IS NOT NULL AND files_deleted_at IS NULL
        """,
        batch_id,
    )


def _scalar(sql: str, batch_id: str) -> int:
    with connection() as conn:
        return conn.execute(sql, (batch_id,)).fetchone()["n"]


def cleanup(code: str, batch_ids: list[str]) -> None:
    from app.storage import delete_keys

    for batch_id in batch_ids:
        for prefix in ("certificates", "previews", "sources"):
            delete_keys([k["key"] for k in list_keys(f"{prefix}/{batch_id}/")])
    with connection() as conn:
        conn.execute("DELETE FROM batches WHERE id = ANY(%s)", (batch_ids,))
        conn.execute("DELETE FROM students WHERE name_en LIKE '%EXPIRED'")
        conn.execute(
            "DELETE FROM exams WHERE program_id IN (SELECT id FROM exam_programs WHERE code = %s)",
            (code,),
        )
        conn.execute("DELETE FROM exam_programs WHERE code = %s", (code,))
    print("\n(ล้างข้อมูลทดสอบเรียบร้อย)")


if __name__ == "__main__":
    raise SystemExit(main())
