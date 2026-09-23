"""เทสการคัดหน้าของผู้เข้าสอบคนเดียวออกจากไฟล์ที่แอดมินอัปมา

แอดมินโยน PDF เข้ามาให้คนใดคนหนึ่งโดยตรง ระบบต้องตรวจก่อนว่าไฟล์เป็นของคนนั้นจริง
(เลขและชื่อต้องตรง) และต้องคัดเฉพาะหน้าของคนนั้นออกมา ไม่ใช่ประมวลผลทั้งเล่มที่ต้นทางส่งกลับมา
"""

import pymupdf
import pytest

from app.certificate_profiles import get_profile
from app.tasks.split import pick_own_page
from tests.fixtures.builders import make_bundle_pdf

PROFILE = get_profile("HKIMO", "FINAL")
GOLD = PROFILE.catalog.get("GOLD")
PERFECT = PROFILE.catalog.get("PERFECT_SCORE")

MALEE = {"name": "MALEE RUNGROJ", "country": "THAILAND", "level": "PRIMARY 3", "cert_no": "900103", "award": "Gold"}
SOMEONE_ELSE = {"name": "SOMCHAI JAIDEE", "country": "THAILAND", "level": "PRIMARY 3", "cert_no": "900101", "award": "Gold"}
ENTRY = {"candidate_no": "900103", "name_en": "MALEE RUNGROJ", "name_th": None}


def pick(entries: list[dict], award=GOLD, entry=ENTRY):
    with pymupdf.open(stream=make_bundle_pdf(entries), filetype="pdf") as doc:
        return pick_own_page(doc, PROFILE, 2026, entry, award)


def test_ไฟล์ของคนที่ถูกต้องผ่านได้():
    index, note = pick([MALEE])
    assert index == 0
    assert note == {"sourcePages": 1, "usedPage": 1}


def test_หยิบไฟล์ผิดคนต้องไม่รับ_และบอกว่าเป็นของใคร():
    with pytest.raises(ValueError) as err:
        pick([SOMEONE_ELSE])
    message = str(err.value)
    assert "900103" in message and "900101" in message and "SOMCHAI JAIDEE" in message


def test_แก้ชื่อมาแต่ลืมแก้เลข_ต้องบอกให้ชัดว่าต้องแก้อะไร():
    # เคสจริงที่เจอ: แอดมินแก้ไฟล์เอง เปลี่ยนแค่ชื่อ ลืมแก้บรรทัด Cert No
    with pytest.raises(ValueError) as err:
        pick([dict(SOMEONE_ELSE, name="MALEE RUNGROJ")])
    message = str(err.value)
    assert "900101" in message and "900103" in message and "Cert No" in message


def test_เลขตรงแต่ชื่อไม่ตรงต้องไม่รับ():
    with pytest.raises(ValueError, match="ชื่อ"):
        pick([dict(MALEE, name="PIYADA SRISUK")])


def test_ไฟล์รวมเล่ม_คัดเฉพาะหน้าของคนนั้น():
    others = [dict(SOMEONE_ELSE, cert_no=str(210000 + i)) for i in range(20)]
    index, note = pick([*others, MALEE])
    assert index == 20
    assert note["sourcePages"] == 21 and note["usedPage"] == 21
    assert "21 หน้า" in note["note"]


def test_คนเดียวมีหลายใบในเล่ม_เลือกด้วยข้อความรางวัลบนหน้า():
    perfect = dict(MALEE)
    perfect.pop("award")  # หน้า Perfect Score ไม่มีข้อความรางวัล
    assert pick([perfect, MALEE], GOLD)[0] == 1
    assert pick([perfect, MALEE], PERFECT)[0] == 0


def test_คนเดียวหลายหน้าแยกไม่ออก_ต้องไม่เดา_และบอกให้แยกไฟล์มา():
    with pytest.raises(ValueError) as err:
        pick([MALEE, MALEE], GOLD)
    assert "2 หน้า" in str(err.value) and "หน้าเดียว" in str(err.value)


def test_ไฟล์ผิดคนหลายร้อยหน้า_ข้อความต้องไม่ยาวเป็นพรืด():
    others = [dict(SOMEONE_ELSE, cert_no=str(210000 + i)) for i in range(200)]
    with pytest.raises(ValueError) as err:
        pick(others)
    message = str(err.value)
    assert "และอีก 195 หน้า" in message
    assert message.count("(") <= 6


def test_หน้าของต่างชาติต้องปฏิเสธ():
    with pytest.raises(ValueError, match="JAPAN"):
        pick([dict(MALEE, country="JAPAN")])


def test_หน้าของรอบอื่นต้องปฏิเสธ():
    with pytest.raises(ValueError, match="HEAT"):
        pick([dict(MALEE, round="Heat")])
