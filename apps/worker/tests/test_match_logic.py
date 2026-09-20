"""เทสตรรกะการตัดสินใจจับคู่ — ส่วนที่ไม่แตะฐานข้อมูล

ทั้งสายงานเต็ม ๆ ทดสอบด้วย scripts/e2e_demo.py
ส่วนนี้เจาะเฉพาะจุดที่ตัดสินว่า "หน้านี้คู่กับแถวไหน" และ "เชื่อได้ไหม"
"""

from app.tasks.match_excel import RosterRow, _find_row, _names_agree


def row(cert_no="", name_en="", award="GOLD AWARD", row_number=2) -> RosterRow:
    return RosterRow(
        row_number=row_number, cert_no=cert_no, name_en=name_en,
        name_th="", level="", school="", award=award,
    )


def page(cert_no=None, name=None):
    return {
        "cert_no": cert_no,
        "extracted_name": name,
        "extracted_name_normalized": name,
    }


def test_เลขผู้เข้าสอบมาก่อนชื่อเสมอ():
    somchai = row(cert_no="900101", name_en="SOMCHAI JAIDEE")
    found, how = _find_row(page("900101", "SOMCHAI JAIDEE"), {"900101": somchai}, {})
    assert (found, how) == (somchai, "cert")


def test_ไม่มีเลขให้ใช้ชื่อแทน():
    somchai = row(name_en="SOMCHAI JAIDEE")
    found, how = _find_row(page(None, "SOMCHAI JAIDEE"), {}, {"SOMCHAI JAIDEE": [somchai]})
    assert (found, how) == (somchai, "name")


def test_ชื่อตรงหลายแถวถือว่าแยกไม่ออก():
    rows = [row(name_en="SOMCHAI JAIDEE", row_number=2), row(name_en="SOMCHAI JAIDEE", row_number=3)]
    _, how = _find_row(page(None, "SOMCHAI JAIDEE"), {}, {"SOMCHAI JAIDEE": rows})
    assert how == "name_many"


def test_ไม่เจอทั้งเลขและชื่อ():
    assert _find_row(page("999", "NOBODY HERE"), {}, {}) == (None, "")


def test_เลขตรงแต่ชื่อไม่ตรงต้องไม่ผ่าน():
    # กันกรณีเลขชนกันโดยบังเอิญ หรือ Excel เป็นคนละรอบ
    assert _names_agree(page("900101", "SOMCHAI JAIDEE"), row(name_en="PIYADA SRISUK")) is False


def test_เลขตรงและชื่อตรงผ่าน():
    assert _names_agree(page("900101", "SOMCHAI JAIDEE"), row(name_en="Mr. Somchai Jaidee")) is True


def test_หน้าที่อ่านชื่อไม่ออกให้เชื่อเลขไปก่อน():
    # ดีกว่าทิ้งใบนั้นไปเฉย ๆ เพราะเลขบนหน้ากับใน Excel ตรงกันอยู่แล้ว
    assert _names_agree(page("900101", None), row(name_en="SOMCHAI JAIDEE")) is True
