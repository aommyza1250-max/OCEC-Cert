"""เทสการเติมไฟล์ของคนที่ตกหล่นทีละใบ

แอดมินโยน PDF เข้ามาตรง ๆ ในบล็อกของคนนั้น ไม่ต้องสร้างโฟลเดอร์ ไม่ต้องอัด ZIP
ระบบต้องตรวจก่อนว่าไฟล์เป็นของคนที่ควรจะเป็นจริง ก่อนลงมือประมวลผลอะไรทั้งนั้น
และต้องคัดเฉพาะหน้าของคนนั้นออกมา ไม่ใช่ประมวลผลทั้งเล่มที่ต้นทางส่งกลับมา
"""

import os
import tempfile

import pymupdf
import pytest

from app.tasks.extract import PageInfo
from app.tasks.split import _pick_own_page, _resolve_award
from app.tasks.zip_bundle import Bundle
from tests.fixtures.builders import make_bundle_pdf


def write_pdf(path: str, entries: list[dict]) -> str:
    with open(path, "wb") as fp:
        fp.write(make_bundle_pdf(entries))
    return path


def pick(path: str, workdir: str, cert_no: str, name: str = "", award: str = "") -> dict:
    """เรียกตัวคัดหน้าจริง โดยเก็บผลลงไฟล์ใน workdir ของเทส"""
    return _pick_own_page(path, os.path.join(workdir, "picked.pdf"), cert_no, name, award)


def page_count(path: str) -> int:
    with pymupdf.open(path) as doc:
        return doc.page_count


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
        pick(path, d, "203336")  # ไม่โยน error = ผ่าน


def test_หยิบไฟล์ผิดคนต้องไม่รับ_และบอกว่าเป็นของใคร():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [SOMEONE_ELSE])
        with pytest.raises(ValueError) as err:
            pick(path, d, "203336")
        message = str(err.value)
        assert "203336" in message
        assert "203297" in message
        assert "JAYTIPAT CHATRATANAMALAI" in message


def test_แก้ชื่อมาแต่ลืมแก้เลข_ต้องบอกให้ชัดว่าต้องแก้อะไร():
    # เคสจริงที่เจอ: แอดมินแก้ไฟล์เอง เปลี่ยนแค่ชื่อ ลืมแก้บรรทัด Cert No
    # ถ้าบอกแค่ "ไม่ตรง" แอดมินจะไม่รู้ว่าต้องไปแก้อะไรต่อ
    wrong_number = dict(SOMEONE_ELSE, name="PUTTHITHADA ARNON")
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [wrong_number])
        with pytest.raises(ValueError) as err:
            pick(path, d, "203336", "PUTTHITHADA ARNON")
        message = str(err.value)
        assert "ชื่อบนเกียรติบัตรตรงกับ" in message
        assert "203297" in message      # เลขที่อยู่บนหน้าจริง
        assert "203336" in message      # เลขที่ควรจะเป็น
        assert "Cert No" in message     # บอกว่าต้องไปแก้บรรทัดไหน


def test_ชื่อก็ไม่ตรงเลขก็ไม่ตรง_บอกว่าเป็นไฟล์ของใคร():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [SOMEONE_ELSE])
        with pytest.raises(ValueError, match="JAYTIPAT CHATRATANAMALAI"):
            pick(path, d, "203336", "PUTTHITHADA ARNON")


def test_ไฟล์รวมเล่ม_ต้องคัดเฉพาะหน้าของคนนั้นออกมาหน้าเดียว():
    # ของจริงต้นทางส่งไฟล์รวมเล่มกลับมา ไม่ได้แยกหน้าให้
    # ถ้าปล่อยทั้งเล่มเข้าไป ระบบจะไล่อ่านใหม่ทุกหน้าเหมือนนำเข้าทั้งรอบ
    others = [dict(SOMEONE_ELSE, cert_no=str(210000 + i)) for i in range(20)]
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [*others, PUTTHITHADA])
        note = pick(path, d, "203336")

        assert page_count(os.path.join(d, "picked.pdf")) == 1
        assert note["sourcePages"] == 21
        assert note["usedPage"] == 21
        assert "21 หน้า" in note["note"]


def test_ไฟล์หน้าเดียว_ไม่ต้องมีหมายเหตุอะไร():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [PUTTHITHADA])
        note = pick(path, d, "203336")
        assert note["sourcePages"] == 1
        assert "note" not in note


def test_คนเดียวมีหลายใบในเล่ม_เลือกใบที่ขาดจากรางวัล():
    # ในเล่มมีทั้งใบ Gold และใบ Perfect Score ของคนเดียวกัน
    # ใบที่ขาดคือ Gold -> ต้องหยิบหน้าที่พิมพ์ว่า Gold Award
    perfect = dict(PUTTHITHADA)
    perfect.pop("award")  # หน้า Perfect Score ไม่มีข้อความรางวัล
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [perfect, PUTTHITHADA])
        assert pick(path, d, "203336", "", "GOLD")["usedPage"] == 2
        assert pick(path, d, "203336", "", "PERFECT_SCORE")["usedPage"] == 1


def test_คนเดียวหลายหน้าแยกไม่ออก_ต้องไม่เดา_และบอกให้แยกไฟล์มา():
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), [PUTTHITHADA, PUTTHITHADA])
        with pytest.raises(ValueError) as err:
            pick(path, d, "203336", "", "GOLD")
        message = str(err.value)
        assert "2 หน้า" in message
        assert "หน้าเดียว" in message


def test_ไฟล์ผิดคนที่มีหลายร้อยหน้า_ข้อความต้องไม่ยาวเป็นพรืด():
    others = [dict(SOMEONE_ELSE, cert_no=str(210000 + i)) for i in range(200)]
    with tempfile.TemporaryDirectory() as d:
        path = write_pdf(os.path.join(d, "x.pdf"), others)
        with pytest.raises(ValueError) as err:
            pick(path, d, "203336")
        message = str(err.value)
        assert "และอีก 195 หน้า" in message
        assert message.count("(") <= 6


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
