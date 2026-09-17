"""เทสการอ่านข้อมูลจากหน้าเกียรติบัตร

เคสทั้งหมดอิงโครงหน้าจริงของ HKIMO ที่สำรวจไว้ ไม่ใช่โครงที่สมมติขึ้นเอง
ดู docs/pdf-parsing-notes.md
"""

import pymupdf
import pytest

from app.tasks.extract import (
    is_thai_national,
    page_lines,
    page_text,
    read_lines,
    read_page,
    validate_name,
)
from tests.fixtures.builders import make_bundle_pdf


@pytest.fixture
def doc():
    pdf = make_bundle_pdf(
        [
            {
                "name": "JAYTIPAT CHATRATANAMALAI",
                "country": "THAILAND",
                "level": "PRIMARY 3",
                "cert_no": "203297",
                "award": "Gold",
            },
            {
                "name": "TARO YAMADA",
                "country": "JAPAN",
                "level": "PRIMARY 6",
                "cert_no": "203400",
                "award": "Silver",
            },
            # หน้า Perfect Score ของจริงไม่มีบรรทัดรางวัลเลย
            {
                "name": "PUTTHITHADA ARNON",
                "country": "THAILAND",
                "level": "SECONDARY 1",
                "cert_no": "203336",
            },
        ]
    )
    with pymupdf.open(stream=pdf, filetype="pdf") as d:
        yield d


def test_อ่านชื่อได้แม้มีลายเซ็นและชื่องานปนอยู่ก่อน(doc):
    # ชื่องานถูกแตกเป็นบรรทัดละตัวอักษร และลายเซ็นกรรมการมาก่อนเนื้อหา
    assert read_page(doc[0]).name == "JAYTIPAT CHATRATANAMALAI"
    assert read_page(doc[1]).name == "TARO YAMADA"
    assert read_page(doc[2]).name == "PUTTHITHADA ARNON"


def test_อ่านเลขผู้เข้าสอบจาก_Cert_No(doc):
    assert read_page(doc[0]).cert_no == "203297"
    assert read_page(doc[2]).cert_no == "203336"


def test_อ่านระดับชั้นโดยตัดจุลภาคท้ายออก(doc):
    assert read_page(doc[0]).level == "PRIMARY 3"
    assert read_page(doc[2]).level == "SECONDARY 1"


def test_อ่านรางวัลจากบรรทัดบนหน้า(doc):
    assert read_page(doc[0]).award_on_page == "Gold"
    assert read_page(doc[1]).award_on_page == "Silver"


def test_หน้า_Perfect_Score_ไม่มีบรรทัดรางวัล(doc):
    # ของจริงเป็นแบบนี้ รางวัลต้องมาจากชื่อโฟลเดอร์ใน ZIP แทน
    assert read_page(doc[2]).award_on_page is None


def test_อ่านรอบและปีจากบรรทัดชื่องาน(doc):
    info = read_page(doc[0])
    assert info.round_on_page == "FINAL"
    assert info.year == 2026


def test_อ่านรอบ_Heat_ได้ด้วย():
    pdf = make_bundle_pdf(
        [{"name": "SOMCHAI JAIDEE", "cert_no": "1", "round": "Heat", "year": 2025}]
    )
    with pymupdf.open(stream=pdf, filetype="pdf") as d:
        info = read_page(d[0])
    assert info.round_on_page == "HEAT"
    assert info.year == 2025


def test_อ่านสัญชาติ(doc):
    assert read_page(doc[0]).country == "THAILAND"
    assert read_page(doc[1]).country == "JAPAN"


def test_ตรวจสัญชาติไทย(doc):
    assert is_thai_national(page_text(doc[0]), r"from\s+THAILAND") is True
    assert is_thai_national(page_text(doc[1]), r"from\s+THAILAND") is False


def test_ตัดชื่อทิ้งเมื่อหยิบผิดบรรทัด():
    # ชื่อบนเกียรติบัตรเป็นพิมพ์ใหญ่ล้วนเสมอ อะไรที่ไม่เข้ารูปแบบต้องคืน None
    assert validate_name("Hong Kong International Mathematical Olympiad") is None
    assert validate_name("สมชาย ใจดี") is None
    assert validate_name("JAYTIPAT CHATRATANAMALAI") == "JAYTIPAT CHATRATANAMALAI"
    assert validate_name("O'BRIEN PATRICK") == "O'BRIEN PATRICK"
    assert validate_name("") is None


def test_ยุบช่องว่างที่_PDF_แทรกมา():
    lines = page_lines("Cert  No:   555\nThis  is  awarded  to\nSOMCHAI   JAIDEE\n")
    assert lines[1] == "This is awarded to"
    info = read_lines(lines)
    assert info.name == "SOMCHAI JAIDEE"
    assert info.cert_no == "555"
