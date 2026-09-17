"""สกัดข้อมูลออกจากหน้าเกียรติบัตร

ตรรกะในไฟล์นี้อ้างอิงจากสคริปต์ `rename_pdf_text.py` ที่ทดสอบกับไฟล์จริงมาแล้ว
ไม่ใช่การเดารูปแบบเอง หน้าเกียรติบัตรจริงมีโครงประมาณนี้:

    Certificate No: 12345
    This is awarded to
    SOMCHAI JAIDEE              <-- ชื่อ
    from THAILAND               <-- สัญชาติ
    for outstanding achievement in Primary 5    <-- ระดับชั้น

ชื่อหาได้ 2 ทาง (เผื่อแบบฟอร์มต่างรุ่นกัน):
  1. บรรทัด "ก่อน" บรรทัดที่ขึ้นต้นด้วย "from "
  2. บรรทัด "ถัดจาก" ข้อความ "This is awarded to"

ทุก pattern ปรับผ่าน environment ได้ ดู docs/pdf-parsing-notes.md
"""

import re
from dataclasses import dataclass
from typing import Any

from ..config import settings


@dataclass(frozen=True)
class PageInfo:
    """ข้อมูลที่อ่านได้จากหน้าเกียรติบัตร 1 หน้า"""

    name: str | None
    level: str | None
    cert_no: str | None
    country: str | None


def page_text(page: Any) -> str:
    """ข้อความดิบทั้งหน้า — เก็บลง staging_pages.raw_text ไว้ให้แอดมินตรวจย้อนหลัง"""
    return page.get_text("text") or ""


def page_lines(text: str) -> list[str]:
    """ตัดเป็นบรรทัด ยุบช่องว่างซ้ำ และทิ้งบรรทัดว่าง

    ต้องยุบช่องว่างก่อนเทียบ เพราะ PDF มักแทรกช่องว่างระหว่างตัวอักษรเพื่อจัดระยะ
    """
    return [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]


def read_page(page: Any) -> PageInfo:
    return read_lines(page_lines(page_text(page)))


def read_lines(lines: list[str]) -> PageInfo:
    cfg = settings()
    country_prefix = cfg.country_line_prefix
    name_anchor = cfg.name_anchor
    level_prefix = cfg.level_line_prefix
    cert_pattern = re.compile(cfg.cert_no_pattern)

    name: str | None = None
    level: str | None = None
    cert_no: str | None = None
    country: str | None = None

    for index, line in enumerate(lines):
        if line.startswith(country_prefix):
            country = line[len(country_prefix):].strip(" .,") or None
            # ชื่ออยู่บรรทัดก่อนหน้าสัญชาติ
            if name is None and index > 0:
                name = lines[index - 1]
        elif line == name_anchor and name is None and index + 1 < len(lines):
            name = lines[index + 1]
        elif line.startswith(level_prefix):
            level = line[len(level_prefix):].strip(" ,") or None

        if cert_no is None:
            found = cert_pattern.search(line)
            if found:
                cert_no = (found.group(1) if found.groups() else found.group(0)).strip()

    return PageInfo(name=validate_name(name), level=level, cert_no=cert_no, country=country)


def validate_name(name: str | None) -> str | None:
    """ชื่อบนเกียรติบัตรเป็นอังกฤษพิมพ์ใหญ่ล้วนเสมอ

    ถ้าไม่เข้ารูปแบบ แปลว่าหยิบผิดบรรทัด (เช่นไปได้ชื่อการแข่งขันหรือข้อความประกอบมา)
    คืน None ดีกว่าคืนค่าผิด เพราะชื่อผิดจะทำให้จับคู่ผิดคน
    """
    if not name:
        return None
    return name if re.fullmatch(settings().name_validation_pattern, name) else None


def extract_name(page: Any, name_pattern: str = "") -> str | None:
    """หาชื่อจากหน้า — ใช้ regex ที่กำหนดเองก่อน ถ้าไม่มีจึงใช้ anchor ตามปกติ"""
    if name_pattern:
        match = re.search(name_pattern, page_text(page), re.IGNORECASE | re.MULTILINE)
        if match and match.lastindex:
            return match.group(1).strip() or None
        return None
    return read_page(page).name


def is_thai_national(text: str, pattern: str) -> bool:
    """ตรวจว่าหน้านี้เป็นของผู้เข้าสอบสัญชาติไทยหรือไม่ (ใช้กับ batch รวมประเทศ)

    หน้าที่ไม่พบข้อความสัญชาติเลยถือว่า "ไม่ใช่คนไทย" โดยตั้งใจ
    ปลอดภัยกว่าการเผลอเอาเกียรติบัตรของชาติอื่นเข้าระบบ
    """
    return re.search(pattern, text, re.IGNORECASE) is not None
