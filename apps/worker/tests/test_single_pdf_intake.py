"""เทสการเติมไฟล์ของคนที่ตกหล่นทีละใบ

แอดมินโยน PDF เข้ามาตรง ๆ ในบล็อกของคนนั้น ไม่ต้องสร้างโฟลเดอร์ ไม่ต้องอัด ZIP
ระบบต้องตรวจก่อนว่าไฟล์เป็นของคนที่ควรจะเป็นจริง ก่อนลงมือประมวลผลอะไรทั้งนั้น
"""

import os
import tempfile

import pytest

from app.tasks.extract import PageInfo
from app.tasks.split import _prepare_single_pdf, _resolve_award, _verify_belongs_to
from app.tasks.zip_bundle import Bundle
from tests.fixtures.builders import make_bundle_pdf


def write_pdf(path: str, entries: list[dict]) -> str:
    with open(path, "wb") as fp:
        fp.write(make_bundle_pdf(entries))
    return path


PUTTHITHADA = {
    "name": "PUTTHITHADA ARNON",
    "country": "THAILAND",
    "level": "PRIMARY 3",
    "cert_no": "203336",
    "award": "Gold",
}
SOMEONE_ELSE = {
    "name": "JAYTIPAT CHATRATANAMALAI",
    "country": "THAILAND",
    "level": "PRIMARY 3",
    "cert_no": "203297",
    "award": "Gold",
}


def test_ไฟล์ของคนที่ถูกต้องผ่านได้():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [PUTTHITHADA])
        _verify_belongs_to(path, "203336")  # ไม่โยน error = ผ่าน


def test_หยิบไฟล์ผิดคนต้องไม่รับ_และบอกว่าเป็นของใคร():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [SOMEONE_ELSE])
        with pytest.raises(ValueError) as err:
            _verify_belongs_to(path, "203336")
        message = str(err.value)
        assert "203336" in message
        assert "203297" in message
        assert "JAYTIPAT CHATRATANAMALAI" in message


def test_ไฟล์ที่มีหลายหน้า_ขอแค่มีหน้าของคนนั้นอยู่ด้วย():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [SOMEONE_ELSE, PUTTHITHADA])
        _verify_belongs_to(path, "203336")


def test_รางวัลอ่านจากหน้ากระดาษก่อนค่าที่คาดไว้():
    # ระบบคาดว่าเป็น Gold แต่บนหน้าพิมพ์ว่า Silver -> เชื่อหน้ากระดาษ
    bundle = Bundle(award="GOLD", source_file="x.pdf")
    info = PageInfo(name="A B", level=None, cert_no="1", country=None, award_on_page="Silver")
    assert _resolve_award(bundle, info, prefer_page_award=True).award == "SILVER"


def test_หน้าที่ไม่มีบรรทัดรางวัลใช้ค่าที่คาดไว้():
    # หน้า Perfect Score ไม่มีข้อความรางวัลพิมพ์อยู่
    bundle = Bundle(award="PERFECT_SCORE", source_file="x.pdf")
    info = PageInfo(name="A B", level=None, cert_no="1", country=None, award_on_page=None)
    assert _resolve_award(bundle, info, prefer_page_award=True).award == "PERFECT_SCORE"


def test_ทางอัป_ZIP_ต้องเชื่อโฟลเดอร์เสมอ():
    # โฟลเดอร์คือแหล่งความจริงของรางวัล ห้ามให้ข้อความบนหน้ามาแทนที่
    bundle = Bundle(award="GOLD", source_file="Gold/x.pdf")
    info = PageInfo(name="A B", level=None, cert_no="1", country=None, award_on_page="Silver")
    assert _resolve_award(bundle, info, prefer_page_award=False).award == "GOLD"
