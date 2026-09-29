"""เทสการอ่าน ตรวจ และวางแผนสลับรายชื่อผู้เข้าสอบ — ส่วนที่ไม่แตะฐานข้อมูล

ไฟล์ผิดต้องปฏิเสธทั้งร่าง และต้องบอกปัญหาครบทุกแถวในครั้งเดียว
รายการที่แอดมินเพิ่มเองต้องรอดจากการอัป Excel ชุดใหม่เสมอ
"""

import pytest

from app.tasks.roster import (
    ActivationRejected,
    EntrySnapshot,
    RosterRow,
    detect_conflicts,
    parse_mode,
    plan_activation,
    validate_roster,
)
from tests.fixtures.builders import make_roster_xlsx


def row(no="900101", name="SOMCHAI JAIDEE", mode="ONLINE", **extra) -> dict:
    return {"cert_no": no, "name_en": name, "mode": mode, "level": "PRIMARY 3", "award": "GOLD", **extra}


def messages(result) -> list[str]:
    return [e["message"] for e in result.errors]


# ---------------------------------------------------------------- ตรวจไฟล์


def test_อ่านไฟล์รวม_online_และ_onsite_พร้อมนับยอด():
    result = validate_roster(make_roster_xlsx([
        row("1", "A ONE", "ONLINE"), row("2", "B TWO", "onsite"), row("3", "C THREE", " Online "),
    ]))
    assert result.ok
    assert result.counts() == {"total": 3, "online": 2, "onsite": 1}
    assert [r.exam_mode for r in result.rows] == ["ONLINE", "ONSITE", "ONLINE"]


def test_ไม่มีคอลัมน์รูปแบบการสอบต้องปฏิเสธทั้งร่าง():
    data = make_roster_xlsx(
        [{"cert_no": "1", "name_en": "A ONE"}],
        headers={"cert_no": "CANDIDATE NO", "name_en": "CANDIDATE NAME"},
    )
    result = validate_roster(data)
    assert not result.ok
    assert result.rows == []
    assert any("EXAM MODE" in m for m in messages(result))


def test_รูปแบบการสอบว่างหรือไม่รู้จัก_รายงานครบทุกแถว():
    result = validate_roster(make_roster_xlsx([
        row("1", mode=""), row("2", "B TWO", "On-site"), row("3", "C THREE", "ออนไลน์"), row("4", "D FOUR"),
    ]))
    assert not result.ok
    assert sorted(e["row"] for e in result.errors) == [2, 3, 4]
    assert any("ไม่ได้ระบุ" in m for m in messages(result))
    assert any("On-site" in m for m in messages(result))


def test_รับเฉพาะ_ONLINE_และ_ONSITE_หลังตัดช่องว่างและไม่สนตัวพิมพ์():
    assert parse_mode("  onsite ") == "ONSITE"
    assert parse_mode("ONLINE") == "ONLINE"
    assert parse_mode("on site") is None
    assert parse_mode("Online exam") is None


def test_เลขผู้เข้าสอบซ้ำข้าม_online_onsite_ต้องปฏิเสธ():
    result = validate_roster(make_roster_xlsx([row("1", "A ONE", "ONLINE"), row("1", "B TWO", "ONSITE")]))
    assert not result.ok
    assert {e["row"] for e in result.errors} == {2, 3}
    assert all("ซ้ำ" in m for m in messages(result))


def test_แถวที่ไม่มีเลขหรือไม่มีชื่อต้องรายงาน():
    result = validate_roster(make_roster_xlsx([row(""), row("2", name="")]))
    assert {e["row"] for e in result.errors} == {2, 3}


def test_เลขที่ไม่ใช่ตัวเลขล้วนต้องรายงาน():
    result = validate_roster(make_roster_xlsx([row("HK-12")]))
    assert any("ตัวเลขล้วน" in m for m in messages(result))


def test_เลขที่อ่านมาเป็นทศนิยมต้องตัดให้เหลือตัวเลข():
    assert validate_roster(make_roster_xlsx([row("900101.0")])).rows[0].candidate_no == "900101"


def test_หัวตารางหลายแบบและภาษาไทย():
    data = make_roster_xlsx(
        [{"no": "1", "th": "สมชาย ใจดี", "mode": "onsite", "school": "โรงเรียนตัวอย่าง"}],
        headers={"no": "เลขผู้เข้าสอบ", "th": "ชื่อ-นามสกุล", "mode": "รูปแบบการสอบ", "school": "โรงเรียน"},
    )
    result = validate_roster(data)
    assert result.ok
    assert result.rows[0].name_th == "สมชาย ใจดี"
    assert result.rows[0].school == "โรงเรียนตัวอย่าง"


def test_ข้ามหัวกระดาษและแถวว่าง_เลขแถวตรงกับไฟล์จริง():
    data = make_roster_xlsx([row("1"), {}, row("2", "B TWO")], junk_rows_before_header=2)
    result = validate_roster(data)
    assert result.ok
    assert [r.row_number for r in result.rows] == [4, 6]


def test_ไฟล์ที่ไม่ใช่_Excel():
    result = validate_roster(b"not an xlsx")
    assert not result.ok
    assert "Excel" in messages(result)[0]


def test_หาหัวตารางไม่เจอ():
    result = validate_roster(make_roster_xlsx([{"x": "1"}], headers={"x": "จำนวนเงิน"}))
    assert "หัวตาราง" in messages(result)[0]


# ---------------------------------------------------------------- ชนกับรายการที่เพิ่มเอง


def entry(no, name="SOMCHAI JAIDEE", mode="ONLINE", source="EXCEL", id=None) -> EntrySnapshot:
    return EntrySnapshot(
        id=id or f"e-{no}", candidate_no=no, name_en=name, name_th=None, exam_mode=mode,
        school=None, level=None, source=source,
    )


def rrow(no, name="SOMCHAI JAIDEE", mode="ONLINE", number=2) -> RosterRow:
    return RosterRow(row_number=number, candidate_no=no, name_en=name, name_th="", exam_mode=mode,
                     level="", school="", award="")


def test_ชนเมื่อเลขเดียวกันหรือชื่อเดียวกัน():
    manual = [entry("900", "MALEE RUNGROJ", source="MANUAL"), entry("901", "ANAN SUKSAWAT", source="MANUAL")]
    rows = [rrow("900", "MALEE RUNGROJ"), rrow("555", "ANAN SUKSAWAT", number=3), rrow("777", "OTHER PERSON")]
    conflicts = detect_conflicts(rows, manual)
    assert {(c["manualEntryId"], c["incomingCandidateNo"], c["reason"]) for c in conflicts} == {
        ("e-900", "900", "SAME_NUMBER"),
        ("e-901", "555", "SAME_NAME"),
    }


# ---------------------------------------------------------------- วางแผนสลับรายชื่อ


def test_สลับรายชื่อ_แทนที่รายการจาก_Excel_และคงรายการที่เพิ่มเอง():
    existing = [entry("1"), entry("2", "B TWO"), entry("9", "MANUAL PERSON", source="MANUAL")]
    rows = [rrow("1"), rrow("3", "C THREE")]
    plan = plan_activation(existing, rows, [], [])
    assert [r.candidate_no for r in plan.creates] == ["3"]
    assert [(e.candidate_no, r.candidate_no) for e, r in plan.updates] == [("1", "1")]
    assert [e.candidate_no for e in plan.deletes] == ["2"]
    assert not plan.merges


def test_ชนกับรายการที่เพิ่มเองต้องตัดสินก่อน():
    existing = [entry("9", source="MANUAL")]
    rows = [rrow("9")]
    conflicts = detect_conflicts(rows, [existing[0]])
    with pytest.raises(ActivationRejected, match="ยังไม่ได้ตัดสิน"):
        plan_activation(existing, rows, conflicts, [])


def test_เก็บรายการเดิม_ตัดแถวใหม่ที่ชนออก():
    existing = [entry("9", source="MANUAL")]
    rows = [rrow("9"), rrow("10", "OTHER ONE")]
    conflicts = detect_conflicts(rows, existing)
    plan = plan_activation(existing, rows, conflicts, [{"conflictId": conflicts[0]["id"], "action": "KEEP_MANUAL"}])
    assert [r.candidate_no for r in plan.excluded_rows] == ["9"]
    assert [r.candidate_no for r in plan.creates] == ["10"]


def test_รวมกับแถวใหม่โดยเลือกค่าเอง():
    manual = EntrySnapshot(id="m", candidate_no="9", name_en="SOMCHAI JAIDE", name_th=None,
                           exam_mode="ONSITE", school="A", level=None, source="MANUAL")
    rows = [rrow("9", "SOMCHAI JAIDEE", "ONLINE")]
    conflicts = detect_conflicts(rows, [manual])
    plan = plan_activation([manual], rows, conflicts, [{
        "conflictId": conflicts[0]["id"], "action": "MERGE",
        "fields": {"examMode": "MANUAL", "name": "INCOMING", "school": "MANUAL"},
    }])
    ((target, values, _),) = plan.merges
    assert target.id == "m"
    assert values["nameEn"] == "SOMCHAI JAIDEE"
    assert values["examMode"] == "ONSITE"
    assert values["school"] == "A"
    assert not plan.creates


def test_ตัดสินขัดกันเองต้องปฏิเสธ():
    # แถวเลข 5 ชื่อตรงกับ M1 และเลขตรงกับ M2 — จะรวมกับ M1 แต่ตัดทิ้งเพราะ M2 ไม่ได้
    m1 = entry("9", "MALEE RUNGROJ", source="MANUAL", id="m1")
    m2 = entry("5", "ANAN SUKSAWAT", source="MANUAL", id="m2")
    rows = [rrow("5", "MALEE RUNGROJ")]
    conflicts = detect_conflicts(rows, [m1, m2])
    decide = {c["manualEntryId"]: c["id"] for c in conflicts}
    with pytest.raises(ActivationRejected, match="ขัดกัน"):
        plan_activation([m1, m2], rows, conflicts, [
            {"conflictId": decide["m1"], "action": "MERGE"},
            {"conflictId": decide["m2"], "action": "KEEP_MANUAL"},
        ])


def test_รายการที่เพิ่มเองรวมได้แค่แถวเดียว():
    manual = entry("9", "MALEE RUNGROJ", source="MANUAL", id="m")
    rows = [rrow("9", "MALEE RUNGROJ"), rrow("5", "MALEE RUNGROJ", number=3)]
    conflicts = detect_conflicts(rows, [manual])
    with pytest.raises(ActivationRejected, match="แถวเดียว"):
        plan_activation([manual], rows, conflicts,
                        [{"conflictId": c["id"], "action": "MERGE"} for c in conflicts])
