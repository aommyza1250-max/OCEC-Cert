"""เทสทั้งสายงานนำเข้ากับฐานข้อมูลจริง (ocec_test) — รายชื่อ -> ZIP -> จับคู่ -> แก้ไข

ต้องตั้ง TEST_DATABASE_URL ไว้ ไม่งั้นเทสในไฟล์นี้ถูกข้ามทั้งหมด (ดู tests/conftest.py)
ไฟล์ทั้งหมดสร้างสดด้วย tests/fixtures/builders.py ไม่มีไฟล์จริง
"""

import json

import pytest

import app.tasks.split as split_module
from app.db import connection, new_id
from app.storage import upload_bytes
from app.tasks.match import run_match
from app.tasks.roster import run_roster_activate, run_roster_validate
from app.tasks.split import rollback_job_outputs, run_split
from app.tasks.zip_bundle import ZipLayoutError
from tests.fixtures.builders import make_bundle_pdf, make_roster_xlsx, make_zip

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

SOMCHAI = {"no": "100001", "name": "SOMCHAI JAIDEE", "mode": "ONLINE"}
MALEE = {"no": "100002", "name": "MALEE RUNGROJ", "mode": "ONSITE"}
ANAN = {"no": "100003", "name": "ANAN SUKSAWAT", "mode": "ONLINE"}


def noop(_progress):
    pass


# ---------------------------------------------------------------- ตัวช่วย


def make_batch(program="HKIMO", exam_round="FINAL", year=2026) -> str:
    program_id, exam_id, batch_id = new_id(), new_id(), new_id()
    with connection() as conn:
        conn.execute(
            "INSERT INTO exam_programs (id, code, name, updated_at) VALUES (%s, %s, %s, NOW())",
            (program_id, program, program),
        )
        conn.execute(
            "INSERT INTO exams (id, program_id, round, year) VALUES (%s, %s, %s, %s)",
            (exam_id, program_id, exam_round, year),
        )
        conn.execute(
            """
            INSERT INTO batches (id, exam_id, status, profile_key, updated_at)
            VALUES (%s, %s, 'DRAFT', %s, NOW())
            """,
            (batch_id, exam_id, f"{program}_{exam_round}"),
        )
    return batch_id


def make_job(batch_id: str, job_type: str, payload: dict | None = None) -> str:
    job_id = new_id()
    with connection() as conn:
        conn.execute(
            "INSERT INTO jobs (id, type, batch_id, payload, status) VALUES (%s, %s, %s, %s, 'RUNNING')",
            (job_id, job_type, batch_id, json.dumps(payload or {})),
        )
    return job_id


def roster_rows(*people: dict, **extra) -> list[dict]:
    return [
        {"cert_no": p["no"], "name_en": p["name"], "mode": p["mode"], "level": p.get("level", "PRIMARY 3"),
         "award": p.get("award", "GOLD"), **extra}
        for p in people
    ]


def draft_roster(batch_id: str, rows: list[dict], headers: dict | None = None) -> str:
    key = f"sources/{batch_id}/roster-{new_id()}.xlsx"
    upload_bytes(key, make_roster_xlsx(rows, headers=headers), XLSX)
    import_id = new_id()
    with connection() as conn:
        conn.execute(
            "INSERT INTO roster_imports (id, batch_id, source_key) VALUES (%s, %s, %s)",
            (import_id, batch_id, key),
        )
    run_roster_validate(batch_id, noop, {"importId": import_id})
    return import_id


def activate(batch_id: str, import_id: str, resolutions: list | None = None) -> dict:
    with connection() as conn:
        conn.execute("UPDATE roster_imports SET status = 'ACTIVATING' WHERE id = %s", (import_id,))
    stats = run_roster_activate(
        batch_id, noop, {"importId": import_id, "resolutions": resolutions or [], "sessionId": "test-session"}
    )
    run_match(batch_id, noop)
    return stats


def use_roster(batch_id: str, *people: dict) -> str:
    import_id = draft_roster(batch_id, roster_rows(*people))
    activate(batch_id, import_id)
    return import_id


def page_of(person: dict, **extra) -> dict:
    return {"name": person["name"], "cert_no": person["no"], "country": "THAILAND", "level": "PRIMARY 3",
            "award": "Gold", **extra}


def upload_zip(batch_id: str, files: dict[str, bytes]) -> dict:
    key = f"sources/{batch_id}/bundle-{new_id()}.zip"
    upload_bytes(key, make_zip(files), "application/zip")
    payload = {"kind": "zip", "zipKey": key, "fileName": "certs.zip"}
    return run_split(batch_id, make_job(batch_id, "SPLIT", payload), noop, payload)


def pdf(*entries: dict) -> bytes:
    return make_bundle_pdf(list(entries))


def pages(batch_id: str) -> list[dict]:
    with connection() as conn:
        return conn.execute(
            """
            SELECT sp.id::text, sp.page_number, sp.match_status::text AS status, sp.cert_no, sp.award,
                   sp.exam_mode::text AS mode, sp.roster_entry_id::text, sp.pdf_key, sp.review,
                   sp.school_on_page, sp.superseded_by_id::text, sp.source_job_id::text
            FROM staging_pages sp WHERE batch_id = %s ORDER BY page_number
            """,
            (batch_id,),
        ).fetchall()


def certificates(batch_id: str) -> list[dict]:
    with connection() as conn:
        return conn.execute(
            """
            SELECT c.id::text, c.award, c.award_label, c.candidate_no, c.staging_page_id::text,
                   c.roster_entry_id::text, c.student_id::text, c.expires_at
            FROM certificates c WHERE batch_id = %s ORDER BY candidate_no, award
            """,
            (batch_id,),
        ).fetchall()


def entries(batch_id: str) -> list[dict]:
    with connection() as conn:
        return conn.execute(
            """
            SELECT id::text, candidate_no, exam_mode::text AS mode, source::text AS source,
                   name_en, student_id::text
            FROM roster_entries WHERE batch_id = %s ORDER BY candidate_no
            """,
            (batch_id,),
        ).fetchall()


def add_manual_entry(batch_id: str, person: dict) -> str:
    entry_id = new_id()
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO roster_entries
              (id, batch_id, candidate_no, name_en, name_en_normalized, exam_mode, source, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'MANUAL', NOW())
            """,
            (entry_id, batch_id, person["no"], person["name"], person["name"], person["mode"]),
        )
    return entry_id


def statuses(batch_id: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for p in pages(batch_id):
        out.setdefault(p["status"], []).append(p["cert_no"])
    return out


# ---------------------------------------------------------------- รายชื่อ


def test_รายชื่อรวม_online_onsite_ใช้แล้วนับยอดถูก(db):
    batch = make_batch()
    import_id = draft_roster(batch, roster_rows(SOMCHAI, MALEE, ANAN))
    with connection() as conn:
        draft = conn.execute(
            "SELECT status::text AS status, total_count, online_count, onsite_count FROM roster_imports WHERE id = %s",
            (import_id,),
        ).fetchone()
    assert draft == {"status": "READY", "total_count": 3, "online_count": 2, "onsite_count": 1}
    assert entries(batch) == []  # ยังเป็นร่าง ไม่แตะรายชื่อที่ใช้อยู่

    activate(batch, import_id)
    assert [(e["candidate_no"], e["mode"]) for e in entries(batch)] == [
        ("100001", "ONLINE"), ("100002", "ONSITE"), ("100003", "ONLINE"),
    ]
    with connection() as conn:
        batch_row = conn.execute(
            "SELECT status::text AS status, active_roster_import_id::text AS active FROM batches WHERE id = %s",
            (batch,),
        ).fetchone()
        audit = conn.execute("SELECT action, session_id FROM audit_events WHERE batch_id = %s", (batch,)).fetchall()
    assert batch_row == {"status": "READY", "active": import_id}
    assert {"action": "ROSTER_ACTIVATED", "session_id": "test-session"} in audit


def test_ร่างที่ผิดไม่แตะรายชื่อที่ใช้อยู่(db):
    batch = make_batch()
    active = use_roster(batch, SOMCHAI)
    bad = draft_roster(batch, roster_rows(MALEE), headers={"cert_no": "CANDIDATE NO", "name_en": "CANDIDATE NAME"})
    with connection() as conn:
        draft = conn.execute("SELECT status::text AS status, errors FROM roster_imports WHERE id = %s", (bad,)).fetchone()
        current = conn.execute("SELECT active_roster_import_id::text AS a FROM batches WHERE id = %s", (batch,)).fetchone()
    assert draft["status"] == "INVALID"
    assert "EXAM MODE" in draft["errors"][0]["message"]
    assert current["a"] == active
    assert [e["candidate_no"] for e in entries(batch)] == ["100001"]


def test_อัปรายชื่อใหม่แทนที่รายการจาก_Excel_และรายการที่เพิ่มเองรอด(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE)
    first_ids = {e["candidate_no"]: e["id"] for e in entries(batch)}
    add_manual_entry(batch, {"no": "100009", "name": "EXTRA PERSON", "mode": "ONLINE"})

    use_roster(batch, SOMCHAI, ANAN)
    after = {e["candidate_no"]: e for e in entries(batch)}
    assert sorted(after) == ["100001", "100003", "100009"]
    assert after["100009"]["source"] == "MANUAL"
    # เลขเดิมแก้ในแถวเดิม ร่องรอยที่ผูกกับคนนั้นจึงไม่หลุด
    assert after["100001"]["id"] == first_ids["100001"]


def test_ชนกับรายการที่เพิ่มเอง_ต้องตัดสินก่อนจึงจะใช้ได้(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    manual = add_manual_entry(batch, MALEE)
    import_id = draft_roster(batch, roster_rows(SOMCHAI, MALEE))
    with connection() as conn:
        conflicts = conn.execute("SELECT conflicts FROM roster_imports WHERE id = %s", (import_id,)).fetchone()["conflicts"]
    assert [(c["manualEntryId"], c["reason"]) for c in conflicts] == [(manual, "SAME_NUMBER")]

    with pytest.raises(ValueError, match="ยังไม่ได้ตัดสิน"):
        activate(batch, import_id)
    with connection() as conn:
        assert conn.execute("SELECT status::text AS s FROM roster_imports WHERE id = %s", (import_id,)).fetchone()["s"] == "READY"

    activate(batch, import_id, [{"conflictId": conflicts[0]["id"], "action": "KEEP_MANUAL"}])
    after = {e["candidate_no"]: e["source"] for e in entries(batch)}
    assert after == {"100001": "EXCEL", "100002": "MANUAL"}


def test_รวมรายการที่เพิ่มเองกับแถวใหม่_กลายเป็นรายการจาก_Excel(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    manual = add_manual_entry(batch, MALEE)
    import_id = draft_roster(batch, roster_rows(SOMCHAI, MALEE))
    with connection() as conn:
        conflict = conn.execute("SELECT conflicts FROM roster_imports WHERE id = %s", (import_id,)).fetchone()["conflicts"][0]
    activate(batch, import_id, [{"conflictId": conflict["id"], "action": "MERGE"}])
    merged = {e["candidate_no"]: e for e in entries(batch)}["100002"]
    assert merged["id"] == manual
    assert merged["source"] == "EXCEL"


# ---------------------------------------------------------------- ZIP + จับคู่


def test_ZIP_รวมสองรูปแบบ_จับคู่ด้วยเลข_ชื่อ_และรูปแบบ(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE)
    stats = upload_zip(batch, {
        "online/Gold/a.pdf": pdf(page_of(SOMCHAI)),
        "onsite/Silver/b.pdf": pdf(page_of(MALEE, award="Silver")),
    })
    assert stats["preflight"]["modes"] == {"ONLINE": {"files": 1, "pages": 1}, "ONSITE": {"files": 1, "pages": 1}}
    assert statuses(batch) == {"MATCHED": ["100001", "100002"]}
    certs = certificates(batch)
    assert [(c["candidate_no"], c["award"], c["award_label"]) for c in certs] == [
        ("100001", "GOLD", "Gold"), ("100002", "SILVER", "Silver"),
    ]
    assert all(e["student_id"] for e in entries(batch))


def test_ชื่อไม่ตรงกับรูปแบบไม่ตรงเป็นคนละสถานะ(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE)
    upload_zip(batch, {
        "online/Gold/a.pdf": pdf(page_of(SOMCHAI, name="PIYADA SRISUK")),
        "online/Gold/b.pdf": pdf(page_of(MALEE)),
    })
    assert statuses(batch) == {"NAME_MISMATCH": ["100001"], "MODE_MISMATCH": ["100002"]}
    assert certificates(batch) == []


def test_อัปหน้าเดิมที่ติดปัญหาซ้ำ_ไม่เกิดรายการตรวจซ้ำ(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    wrong = {"onsite/Gold/a.pdf": pdf(page_of(SOMCHAI))}
    upload_zip(batch, wrong)
    again = upload_zip(batch, wrong)
    assert again["recognized"] == 1
    assert again["newPages"] == 0
    assert len(pages(batch)) == 1


def test_อัปฉบับที่จัดโฟลเดอร์ถูก_แทนหน้าที่รูปแบบไม่ตรง(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    page_pdf = pdf(page_of(SOMCHAI))
    upload_zip(batch, {"onsite/Gold/a.pdf": page_pdf})
    assert statuses(batch) == {"MODE_MISMATCH": ["100001"]}

    stats = upload_zip(batch, {"online/Gold/a.pdf": page_pdf})
    assert stats["superseded"] == 1
    assert statuses(batch) == {"SUPERSEDED": ["100001"], "MATCHED": ["100001"]}
    assert len(certificates(batch)) == 1


def test_อัปซ้ำข้ามใบที่รับไปแล้ว_ไม่แทนที่(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI))})
    before = certificates(batch)
    # หน้าใหม่ (เนื้อหาต่างจากเดิม) ของเลขเดิม รางวัลเดิม — ต้องไม่แทนที่ใบที่รับไปแล้ว
    stats = upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI, level="PRIMARY 4"))})
    assert stats["skippedAccepted"] == 1
    assert certificates(batch) == before


def test_หน้าที่ติดปัญหาไม่ทำให้หน้าที่ถูกซึ่งมาทีหลังถูกข้าม(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI, name="WRONG NAME"))})
    assert statuses(batch) == {"NAME_MISMATCH": ["100001"]}
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI))})
    assert statuses(batch) == {"SUPERSEDED": ["100001"], "MATCHED": ["100001"]}


def test_เพิ่มผู้เข้าสอบที่ตกหล่นแล้ว_หน้าที่รออยู่จับคู่เอง(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    upload_zip(batch, {"onsite/Gold/b.pdf": pdf(page_of(MALEE))})
    assert statuses(batch) == {"UNMATCHED": ["100002"]}
    add_manual_entry(batch, MALEE)
    run_match(batch, noop)
    assert statuses(batch) == {"MATCHED": ["100002"]}


def test_ผู้เข้าสอบที่ยังไม่มีเกียรติบัตรนับแยก_online_onsite(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE, ANAN)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI))})
    with connection() as conn:
        missing = conn.execute(
            """
            SELECT exam_mode::text AS mode, COUNT(*) AS n FROM roster_entries re
            WHERE batch_id = %s AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.roster_entry_id = re.id)
            GROUP BY 1 ORDER BY 1
            """,
            (batch,),
        ).fetchall()
    assert missing == [{"mode": "ONLINE", "n": 1}, {"mode": "ONSITE", "n": 1}]


def test_รอบ_Final_ข้ามต่างชาติ_และส่งหน้าที่ไม่มีหลักฐานสัญชาติให้แอดมิน(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    stats = upload_zip(batch, {"online/Gold/a.pdf": pdf(
        page_of(SOMCHAI),
        {"name": "TARO YAMADA", "cert_no": "200009", "country": "JAPAN", "award": "Gold"},
        {"name": "NO COUNTRY", "cert_no": "200010", "award": "Gold"},
    )})
    assert stats["foreignSkipped"] == 1
    assert stats["nationalityUnverified"] == 1
    by_no = {p["cert_no"]: p for p in pages(batch)}
    assert by_no["100001"]["status"] == "MATCHED"
    assert by_no["200009"]["status"] == "SKIPPED_FOREIGN"
    assert by_no["200009"]["pdf_key"] is None
    assert by_no["200010"]["status"] == "NATIONALITY_UNVERIFIED"
    assert by_no["200010"]["pdf_key"] is not None


def test_รอบ_Heat_เก็บโรงเรียนบนหน้า_โรงเรียนในรายชื่อเป็นค่าหลัก(db):
    batch = make_batch(exam_round="HEAT")
    import_id = draft_roster(batch, roster_rows(SOMCHAI, school="Sample Wittaya"),
                             headers={"cert_no": "CANDIDATE NO", "name_en": "CANDIDATE NAME", "mode": "EXAM MODE",
                                      "level": "GRADE", "award": "AWARD", "school": "SCHOOL"})
    activate(batch, import_id)
    upload_zip(batch, {"online/Participation/a.pdf": pdf(
        {"name": SOMCHAI["name"], "cert_no": SOMCHAI["no"], "school": "OTHER SCHOOL", "round": "Heat", "level": "PRIMARY 3"}
    )})
    (page,) = pages(batch)
    assert page["status"] == "MATCHED"
    assert page["school_on_page"] == "OTHER SCHOOL"
    assert "โรงเรียน" in page["review"]["warnings"][0]
    assert certificates(batch)[0]["award"] == "PARTICIPATION"


def test_ZIP_ผิดโครงสร้างต้องไม่แตะข้อมูลเลย(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    with pytest.raises(ZipLayoutError):
        upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI)), "online/Platinum/b.pdf": pdf(page_of(MALEE))})
    assert pages(batch) == []
    assert not [k for k in db.objects if k.startswith("certificates/")]


def test_งานที่พังกลางทางย้อนได้หมด_และลองใหม่ได้(db, monkeypatch):
    batch = make_batch()
    use_roster(batch, SOMCHAI, ANAN)
    key = f"sources/{batch}/bundle.zip"
    upload_bytes(key, make_zip({"online/Gold/a.pdf": pdf(page_of(SOMCHAI), page_of(ANAN))}), "application/zip")
    payload = {"kind": "zip", "zipKey": key}
    job = make_job(batch, "SPLIT", payload)

    calls = {"n": 0}
    real = split_module.render_webp

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("เครื่องดับกลางทาง")
        return real(*args, **kwargs)

    monkeypatch.setattr(split_module, "render_webp", flaky)
    with pytest.raises(RuntimeError):
        run_split(batch, job, noop, payload)
    assert len(pages(batch)) == 1  # ทำไปได้ครึ่งทาง

    rollback_job_outputs(batch, job)
    assert pages(batch) == []
    assert not [k for k in db.objects if f"/{job}/" in k]

    monkeypatch.setattr(split_module, "render_webp", real)
    run_split(batch, job, noop, payload)
    assert statuses(batch) == {"MATCHED": ["100001", "100003"]}


def test_ย้อนงานคืนหน้าที่ถูกแทนกลับสถานะเดิม(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    page_pdf = pdf(page_of(SOMCHAI))
    upload_zip(batch, {"onsite/Gold/a.pdf": page_pdf})
    key = f"sources/{batch}/fix.zip"
    upload_bytes(key, make_zip({"online/Gold/a.pdf": page_pdf}), "application/zip")
    payload = {"kind": "zip", "zipKey": key}
    job = make_job(batch, "SPLIT", payload)
    run_split(batch, job, noop, payload)
    assert statuses(batch) == {"SUPERSEDED": ["100001"], "MATCHED": ["100001"]}

    rollback_job_outputs(batch, job)
    run_match(batch, noop)
    assert statuses(batch) == {"MODE_MISMATCH": ["100001"]}


def test_จับคู่ซ้ำไม่เปลี่ยนใบเดิม(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI)), "onsite/Gold/b.pdf": pdf(page_of(MALEE))})
    before = certificates(batch)
    run_match(batch, noop)
    run_match(batch, noop)
    assert certificates(batch) == before


def test_ชื่อพ้องสองคนในรอบเดียว_กับคนเดิมหนึ่งคน_ไม่เดาและไม่สร้างคนใหม่(db):
    with connection() as conn:
        conn.execute(
            "INSERT INTO students (id, name_en, name_en_normalized) VALUES (%s, 'SOMCHAI JAIDEE', 'SOMCHAI JAIDEE')",
            (new_id(),),
        )
    batch = make_batch()
    twin = {"no": "100005", "name": SOMCHAI["name"], "mode": "ONLINE"}
    use_roster(batch, SOMCHAI, twin)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI), page_of(twin))})
    assert statuses(batch) == {"AMBIGUOUS": ["100001", "100005"]}
    with connection() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM students").fetchone()["n"] == 1


def test_BBB_ออกใบด้วยรหัสและชื่อรางวัลของตัวเอง(db):
    batch = make_batch(program="BBB")
    use_roster(batch, SOMCHAI)
    upload_zip(batch, {"online/1st Prize/a.pdf": pdf(page_of(SOMCHAI, award="1st Prize"))})
    (cert,) = certificates(batch)
    assert (cert["award"], cert["award_label"]) == ("1ST_PRIZE", "1st Prize")


# ---------------------------------------------------------------- PDF ให้ผู้เข้าสอบคนเดียว


def single(batch_id: str, entry_id: str, data: bytes, award="GOLD", purpose="add", replace=None) -> dict:
    key = f"sources/{batch_id}/single-{new_id()}.pdf"
    upload_bytes(key, data, "application/pdf")
    payload = {"kind": "single", "pdfKey": key, "rosterEntryId": entry_id, "awardCode": award,
               "purpose": purpose, "replacePageId": replace, "sessionId": "test-session", "fileName": "x.pdf"}
    return run_split(batch_id, make_job(batch_id, "SPLIT", payload), noop, payload)


def test_เพิ่มใบให้คนที่ตกหล่น_คัดหน้าของคนนั้นจากไฟล์รวมเล่ม(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE)
    entry_id = {e["candidate_no"]: e["id"] for e in entries(batch)}["100002"]
    stats = single(batch, entry_id, pdf(page_of(SOMCHAI), page_of(MALEE)))
    assert stats["singlePdf"]["usedPage"] == 2
    assert [c["candidate_no"] for c in certificates(batch)] == ["100002"]


def test_เพิ่มใบผิดคนต้องปฏิเสธ_และไม่เหลืออะไรค้าง(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI, MALEE)
    entry_id = {e["candidate_no"]: e["id"] for e in entries(batch)}["100002"]
    with pytest.raises(ValueError, match="100002"):
        single(batch, entry_id, pdf(page_of(SOMCHAI)))
    assert pages(batch) == []


def test_เปลี่ยนไฟล์ใบเดิม_ใบใหม่มาแทนและวันหมดอายุไม่รีเซ็ต(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI))})
    (old,) = certificates(batch)
    with connection() as conn:
        conn.execute("UPDATE certificates SET expires_at = '2028-09-01' WHERE id = %s", (old["id"],))

    single(batch, old["roster_entry_id"], pdf(page_of(SOMCHAI, level="PRIMARY 4")),
           purpose="replace", replace=old["staging_page_id"])
    (new,) = certificates(batch)
    assert new["staging_page_id"] != old["staging_page_id"]
    assert new["expires_at"].date().isoformat() == "2028-09-01"
    assert statuses(batch) == {"SUPERSEDED": ["100001"], "MATCHED": ["100001"]}
    with connection() as conn:
        actions = [r["action"] for r in conn.execute("SELECT action FROM audit_events WHERE batch_id = %s", (batch,))]
    assert "CERTIFICATE_FILE_REPLACED" in actions


def test_เพิ่มใบรางวัลที่มีอยู่แล้วต้องปฏิเสธ(db):
    batch = make_batch()
    use_roster(batch, SOMCHAI)
    upload_zip(batch, {"online/Gold/a.pdf": pdf(page_of(SOMCHAI))})
    entry_id = entries(batch)[0]["id"]
    with pytest.raises(ValueError, match="อยู่แล้ว"):
        single(batch, entry_id, pdf(page_of(SOMCHAI, level="PRIMARY 9")))
