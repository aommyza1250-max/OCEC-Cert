"""เทสการอ่านข้อมูลจากหน้าเกียรติบัตร

เคสทั้งหมดอิงโครงหน้าจริงที่สำรวจไว้ ไม่ใช่โครงที่สมมติขึ้นเอง
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
            {"name": "SOMCHAI JAIDEE", "country": "THAILAND", "level": "Primary 5", "cert_no": "12345"},
            {"name": "TARO YAMADA", "country": "JAPAN", "level": "Primary 6", "cert_no": "12346"},
            # แบบไม่มีบรรทัดสัญชาติ ต้องอาศัย anchor "This is awarded to"
            {"name": "PIYADA SRISUK", "level": "Secondary 1", "cert_no": "12347"},
        ]
    )
    with pymupdf.open(stream=pdf, filetype="pdf") as d:
        yield d


def test_อ่านชื่อจากบรรทัดก่อนบรรทัดสัญชาติ(doc):
    assert read_page(doc[0]).name == "SOMCHAI JAIDEE"
    assert read_page(doc[1]).name == "TARO YAMADA"


def test_อ่านชื่อจาก_anchor_เมื่อไม่มีบรรทัดสัญชาติ(doc):
    assert read_page(doc[2]).name == "PIYADA SRISUK"


def test_อ่านระดับชั้น(doc):
    assert read_page(doc[0]).level == "Primary 5"
    assert read_page(doc[2]).level == "Secondary 1"


def test_อ่านเลขเกียรติบัตร(doc):
    assert read_page(doc[0]).cert_no == "12345"
    assert read_page(doc[1]).cert_no == "12346"


def test_อ่านสัญชาติ(doc):
    assert read_page(doc[0]).country == "THAILAND"
    assert read_page(doc[1]).country == "JAPAN"
    assert read_page(doc[2]).country is None


def test_ตรวจสัญชาติไทย(doc):
    assert is_thai_national(page_text(doc[0]), r"from\s+THAILAND") is True
    assert is_thai_national(page_text(doc[1]), r"from\s+THAILAND") is False


def test_หน้าที่ไม่มีข้อความสัญชาติถือว่าไม่ใช่คนไทย(doc):
    assert is_thai_national(page_text(doc[2]), r"from\s+THAILAND") is False


def test_ตัดชื่อทิ้งเมื่อหยิบผิดบรรทัด():
    # ชื่อบนเกียรติบัตรเป็นพิมพ์ใหญ่ล้วนเสมอ อะไรที่ไม่เข้ารูปแบบต้องคืน None
    assert validate_name("Mathematics Competition 2024") is None
    assert validate_name("สมชาย ใจดี") is None
    assert validate_name("SOMCHAI JAIDEE") == "SOMCHAI JAIDEE"
    assert validate_name("O'BRIEN PATRICK") == "O'BRIEN PATRICK"
    assert validate_name("") is None


def test_ยุบช่องว่างที่_PDF_แทรกมา():
    # PDF มักแทรกช่องว่างเพื่อจัดระยะ ต้องยุบก่อนเทียบกับ anchor
    lines = page_lines("Certificate  No:   555\nThis  is  awarded  to\nSOMCHAI   JAIDEE\n")
    assert lines[1] == "This is awarded to"
    info = read_lines(lines)
    assert info.name == "SOMCHAI JAIDEE"
    assert info.cert_no == "555"
