"""ทดสอบทั้งสายงานผ่านคิวงานจริง ด้วยไฟล์สังเคราะห์ที่เลียนโครงไฟล์จริง (ใช้ตอน dev เท่านั้น)

รันในคอนเทนเนอร์ worker (ต้องมี worker ทำงานอยู่ เพราะงานทั้งหมดเข้าคิวแล้วรอ worker หยิบไปทำ):
    docker compose exec worker python scripts/e2e_demo.py

ทำตามลำดับเดียวกับที่แอดมินทำจริงทุกขั้น:
  สร้างรอบนำเข้า -> อัปรายชื่อ (ตรวจ) -> กดใช้รายชื่อ -> อัป ZIP (ตัดหน้า + จับคู่) -> ตรวจผล

สร้างรอบนำเข้าใต้รายการ HKIMO ด้วยปีทดสอบ (2090 ขึ้นไป) แล้วล้างทิ้งทั้งหมดเมื่อจบ
ถ้าอยากตรวจกับไฟล์จริง ใช้ scripts/check_real_files.py แทน
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _intake import XLSX_MIME, TestBatch, cleanup, create_batch  # noqa: E402
from app.db import connection, new_id  # noqa: E402
from app.storage import upload_bytes  # noqa: E402
from tests.fixtures.builders import make_bundle_pdf, make_roster_xlsx, make_zip  # noqa: E402

HEADERS = {"cert_no": "CANDIDATE NO", "level": "GRADE", "name_en": "CANDIDATE NAME", "award": "AWARD",
           "mode": "EXAM MODE", "school": "SCHOOL"}

failures: list[str] = []


def check(label: str, actual, expected) -> None:
    ok = actual == expected
    print(f"  {'✓' if ok else '✗'} {label}: ได้ {actual} คาดหวัง {expected}")
    if not ok:
        failures.append(label)


def main() -> int:
    created: list[TestBatch] = []
    try:
        heat_case(created)
        final_case(created)
        mode_case(created)
        same_name_case(created)
    finally:
        cleanup(created, "TESTDEMO")
    print("\n" + ("ผ่านทั้งหมด ✓" if not failures else f"มีเคสที่ไม่ผ่าน ✗ {failures}"))
    return 0 if not failures else 1


def heat_case(created: list[TestBatch]) -> None:
    print(f"\n{'=' * 72}\nรอบ Heat — รับทุกหน้า เก็บโรงเรียนบนหน้า และรางวัลเข้าร่วม\n{'=' * 72}")
    target = create_batch("HEAT")
    created.append(target)
    people = [
        person("ALPHA TESTDEMO", "70001", "ONLINE", school="SAMPLE SCHOOL"),
        person("BETA TESTDEMO", "70002", "ONSITE", school="SAMPLE SCHOOL"),
    ]
    use_roster(target, people)
    page = lambda p: {**page_of(p, target), "school": "SAMPLE SCHOOL", "round": "Heat", "award": None}  # noqa: E731
    stats = upload(target, {
        "online/Gold/a.pdf": make_bundle_pdf([page(people[0])]),
        "onsite/Participation/b.pdf": make_bundle_pdf([page(people[1])]),
    })
    check("หน้าที่ตัดแยก", stats["pagesSplit"], 2)
    check("สถานะหน้า", page_statuses(target), {"MATCHED": 2})
    check("รางวัลของใบ", sorted(c["award"] for c in certificates(target)), ["GOLD", "PARTICIPATION"])


def final_case(created: list[TestBatch]) -> None:
    print(f"\n{'=' * 72}\nรอบ Final — ข้ามต่างชาติ ส่งหน้าที่ไม่มีหลักฐานสัญชาติให้แอดมิน\n{'=' * 72}")
    target = create_batch("FINAL")
    created.append(target)
    alpha = person("ALPHA TESTDEMO", "71001", "ONLINE", award="PERFECT SCORER")
    people = [alpha, person("GAMMA TESTDEMO", "71002", "ONLINE")]
    use_roster(target, people)
    stats = upload(target, {
        "online/Gold/a.pdf": make_bundle_pdf([
            page_of(alpha, target),
            {"name": "TARO YAMADA", "cert_no": "71009", "country": "JAPAN", "award": "Gold", "year": target.year},
            {**page_of(people[1], target), "country": None},
        ]),
        # หน้า Perfect Score ของจริงไม่มีบรรทัดรางวัล และใช้เลขเดียวกับใบ Gold ของคนเดียวกัน
        "online/Perfect Score/b.pdf": make_bundle_pdf([{**page_of(alpha, target), "award": None}]),
    })
    check("ข้ามหน้าต่างชาติ", stats["foreignSkipped"], 1)
    check("หน้าที่ไม่มีหลักฐานสัญชาติ", stats["nationalityUnverified"], 1)
    check("คนเดียวได้ 2 ใบจากแถว Excel แถวเดียว",
          sorted(c["award"] for c in certificates(target)), ["GOLD", "PERFECT_SCORE"])

    again = upload(target, {"online/Gold/a.pdf": make_bundle_pdf([page_of(alpha, target)])})
    check("อัปหน้าเดิมซ้ำ ไม่เกิดหน้าใหม่", again["newPages"], 0)


def mode_case(created: list[TestBatch]) -> None:
    print(f"\n{'=' * 72}\nจัดไฟล์ผิดโฟลเดอร์ online/onsite แล้วอัปฉบับแก้มาแทน\n{'=' * 72}")
    target = create_batch("FINAL")
    created.append(target)
    delta = person("DELTA TESTDEMO", "72001", "ONSITE")
    use_roster(target, [delta])
    page_pdf = make_bundle_pdf([page_of(delta, target)])
    upload(target, {"online/Silver/a.pdf": page_pdf})
    check("อยู่ผิดโฟลเดอร์ = รูปแบบไม่ตรง", page_statuses(target), {"MODE_MISMATCH": 1})
    upload(target, {"onsite/Silver/a.pdf": page_pdf})
    check("ฉบับแก้มาแทนหน้าที่ติดปัญหา", page_statuses(target), {"MATCHED": 1, "SUPERSEDED": 1})


def same_name_case(created: list[TestBatch]) -> None:
    print(f"\n{'=' * 72}\nชื่อพ้องสองคนในรอบเดียวกับคนเดิมในระบบ — ต้องส่งให้แอดมิน ไม่สร้างคนใหม่\n{'=' * 72}")
    with connection() as conn:
        conn.execute(
            "INSERT INTO students (id, name_en, name_en_normalized) VALUES (%s, %s, %s)",
            (new_id(), "ECHO TESTDEMO", "ECHO TESTDEMO"),
        )
    target = create_batch("FINAL")
    created.append(target)
    twins = [person("ECHO TESTDEMO", "73001", "ONLINE"), person("ECHO TESTDEMO", "73002", "ONLINE")]
    use_roster(target, twins)
    before = count_students()
    upload(target, {"online/Gold/a.pdf": make_bundle_pdf([page_of(p, target) for p in twins])})
    check("ส่งให้แอดมินตัดสิน", page_statuses(target), {"AMBIGUOUS": 2})
    check("ไม่สร้างผู้เข้าสอบใหม่", count_students(), before)


# ------------------------------------------------------------------ helpers


def person(name: str, cert_no: str, mode: str, award: str = "GOLD", school: str = "") -> dict:
    return {"name": name, "cert_no": cert_no, "mode": mode, "award": award, "level": "PRIMARY 5",
            "school": school}


def page_of(p: dict, target: TestBatch) -> dict:
    return {"name": p["name"], "cert_no": p["cert_no"], "country": "THAILAND", "level": p["level"],
            "award": "Gold", "year": target.year, "round": target.round.title()}


def use_roster(target: TestBatch, people: list[dict]) -> None:
    key = f"sources/{target.batch_id}/roster-{new_id()}.xlsx"
    rows = [{"cert_no": p["cert_no"], "level": p["level"], "name_en": p["name"], "award": p["award"],
             "mode": p["mode"], "school": p["school"]} for p in people]
    upload_bytes(key, make_roster_xlsx(rows, headers=HEADERS), XLSX_MIME)
    import_id = new_id()
    with connection() as conn:
        conn.execute("INSERT INTO roster_imports (id, batch_id, source_key) VALUES (%s, %s, %s)",
                     (import_id, target.batch_id, key))
    wait_for(enqueue(target.batch_id, "ROSTER_VALIDATE", {"importId": import_id}), "ตรวจรายชื่อ")
    with connection() as conn:
        conn.execute("UPDATE roster_imports SET status = 'ACTIVATING' WHERE id = %s", (import_id,))
    wait_for(enqueue(target.batch_id, "ROSTER_ACTIVATE", {"importId": import_id, "sessionId": "e2e"}),
             "ใช้รายชื่อ")


def upload(target: TestBatch, files: dict[str, bytes]) -> dict:
    key = f"sources/{target.batch_id}/bundle-{new_id()}.zip"
    upload_bytes(key, make_zip(files), "application/zip")
    job = enqueue(target.batch_id, "SPLIT", {"kind": "zip", "zipKey": key, "fileName": "demo.zip"})
    wait_for(job, "ตัดหน้าและจับคู่")
    with connection() as conn:
        return conn.execute("SELECT progress FROM jobs WHERE id = %s", (job,)).fetchone()["progress"]


def enqueue(batch_id: str, job_type: str, payload: dict) -> str:
    job_id = new_id()
    with connection() as conn:
        conn.execute("INSERT INTO jobs (id, type, batch_id, payload) VALUES (%s, %s, %s, %s)",
                     (job_id, job_type, batch_id, json.dumps(payload)))
    return job_id


def wait_for(job_id: str, label: str, timeout: float = 180.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with connection() as conn:
            row = conn.execute("SELECT status::text AS status, error FROM jobs WHERE id = %s", (job_id,)).fetchone()
        if row["status"] == "DONE":
            print(f"  {label}: เสร็จแล้ว")
            return
        if row["status"] == "FAILED":
            raise RuntimeError(f"{label} ล้มเหลว: {row['error']}")
        time.sleep(0.5)
    raise TimeoutError(f"{label} ใช้เวลานานเกิน {timeout} วินาที — worker ทำงานอยู่หรือไม่")


def page_statuses(target: TestBatch) -> dict[str, int]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT match_status::text AS s, COUNT(*) AS n FROM staging_pages WHERE batch_id = %s GROUP BY 1",
            (target.batch_id,),
        ).fetchall()
    return {r["s"]: r["n"] for r in rows if r["s"] not in ("SKIPPED_FOREIGN", "NATIONALITY_UNVERIFIED")}


def certificates(target: TestBatch) -> list[dict]:
    with connection() as conn:
        return conn.execute("SELECT award, candidate_no FROM certificates WHERE batch_id = %s",
                            (target.batch_id,)).fetchall()


def count_students() -> int:
    with connection() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM students").fetchone()["n"]


if __name__ == "__main__":
    raise SystemExit(main())
