import pytest

from app.tasks.match_excel import parse_roster
from tests.fixtures.builders import make_roster_xlsx


def test_อ่านหัวตารางภาษาอังกฤษ():
    data = make_roster_xlsx(
        [{"name_en": "Somchai Jaidee", "award": "Gold"}],
        headers={"name_en": "Name", "award": "Award"},
    )
    rows = parse_roster(data)
    assert len(rows) == 1
    assert rows[0].name_en == "Somchai Jaidee"
    assert rows[0].award == "Gold"


def test_อ่านหัวตารางภาษาไทย():
    data = make_roster_xlsx(
        [{"name_th": "สมชาย ใจดี", "award": "เหรียญทอง"}],
        headers={"name_th": "ชื่อ-นามสกุล", "award": "รางวัล"},
    )
    rows = parse_roster(data)
    assert rows[0].name_th == "สมชาย ใจดี"
    assert rows[0].award == "เหรียญทอง"


def test_รวมคอลัมน์ชื่อกับนามสกุลที่แยกกัน():
    data = make_roster_xlsx(
        [{"first": "Somchai", "last": "Jaidee"}],
        headers={"first": "First Name", "last": "Last Name"},
    )
    assert parse_roster(data)[0].name_en == "Somchai Jaidee"


def test_ข้ามหัวกระดาษเหนือหัวตาราง():
    data = make_roster_xlsx(
        [{"name_en": "Piyada Srisuk"}],
        headers={"name_en": "Full Name"},
        junk_rows_before_header=3,
    )
    rows = parse_roster(data)
    assert len(rows) == 1
    assert rows[0].name_en == "Piyada Srisuk"
    # เลขแถวต้องเป็นเลขแถวจริงในไฟล์ เพื่อให้แอดมินเปิดไปดูได้ถูกที่
    assert rows[0].row_number == 5


def test_ข้ามแถวว่าง():
    data = make_roster_xlsx(
        [{"name_en": "A Student"}, {"name_en": ""}, {"name_en": "B Student"}],
        headers={"name_en": "Name"},
    )
    assert [r.name_en for r in parse_roster(data)] == ["A Student", "B Student"]


def test_ไม่มีคอลัมน์ชื่อต้องฟ้องให้ชัด():
    data = make_roster_xlsx(
        [{"x": "1"}], headers={"x": "จำนวนเงิน"}
    )
    with pytest.raises(ValueError, match="หาหัวตาราง"):
        parse_roster(data)


def test_อ่านเลขที่นั่งสอบ():
    data = make_roster_xlsx(
        [{"name_en": "Somchai Jaidee", "code": "A-1024"}],
        headers={"name_en": "Name", "code": "เลขที่นั่งสอบ"},
    )
    assert parse_roster(data)[0].exam_code == "A-1024"
