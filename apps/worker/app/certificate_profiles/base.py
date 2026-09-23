"""สัญญากลางของโปรไฟล์เกียรติบัตร — ทุกรายการสอบต้องคืนผลรูปแบบเดียวกัน

โปรไฟล์ 1 ตัว = รายการสอบ 1 รายการ × รอบ 1 รอบ (เช่น HKIMO_HEAT)
ตัวแยกหน้า (split.py) และตัวจับคู่ (match.py) รู้จักแค่สัญญาในไฟล์นี้
ไม่รู้ว่าข้างในโปรไฟล์อ่านหน้าอย่างไร จึงแก้โปรไฟล์ของรายการหนึ่งได้โดยไม่กระทบรายการอื่น

แยกหน้าที่ชัดเจน:
  - โค้ด Python ในแต่ละโมดูลรายการ = วิธีอ่านข้อความบนหน้า
  - ไฟล์ JSON ใน shared/certificate-profiles/ = รายชื่อรางวัลและชื่อโฟลเดอร์ที่ยอมรับ
    (เว็บอ่านไฟล์เดียวกัน สองฝั่งจึงเหลื่อมกันเงียบ ๆ ไม่ได้)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .manifest import AwardCatalog, PathPolicy


class FromField(str, Enum):
    """ค่าหลังคำว่า from บนหน้าเกียรติบัตรหมายถึงอะไร"""

    SCHOOL = "SCHOOL"    # รอบ Heat: ชื่อโรงเรียน (ผู้เข้าสอบเป็นคนไทยทั้งหมด)
    COUNTRY = "COUNTRY"  # รอบ Final: ประเทศ (ไฟล์รวมทุกประเทศ)
    NONE = "NONE"


class NationalityPolicy(str, Enum):
    ACCEPT_ALL = "ACCEPT_ALL"        # ไม่ต้องกรอง
    THAILAND_ONLY = "THAILAND_ONLY"  # รับเฉพาะ from THAILAND


class Nationality(str, Enum):
    """ผลตรวจสัญชาติของหน้า 1 หน้า"""

    ACCEPT = "ACCEPT"
    FOREIGN = "FOREIGN"
    # ไม่มีหลักฐานพอจะบอกว่าเป็นคนไทย — ห้ามทิ้งเงียบ ๆ และห้ามถือว่าเป็นคนไทยเอง
    UNVERIFIED = "UNVERIFIED"


@dataclass(frozen=True)
class ParsedCertificate:
    """ผลการอ่านหน้าเกียรติบัตร 1 หน้า — รูปแบบเดียวกันทุกโปรไฟล์"""

    name: str | None
    candidate_no: str | None
    level: str | None
    school_on_page: str | None
    country_on_page: str | None
    round_on_page: str | None
    # ปี ค.ศ. บนหน้า ถ้าพิมพ์เป็นช่วงปีการศึกษา (2025 - 2026) จะเป็นปีท้าย
    year_on_page: int | None
    # ข้อความรางวัลบนหน้า ใช้ตรวจทานกับโฟลเดอร์เท่านั้น — หน้า Perfect Score และรอบ Heat
    # ส่วนใหญ่ไม่มีบรรทัดนี้ ซึ่งเป็นเรื่องปกติ
    award_text: str | None
    # ข้อมูลเฉพาะรายการ เช่น วิชาของ HKICO หรือตำแหน่งรางวัลพิเศษของ HKISO
    extra: dict[str, str] = field(default_factory=dict)
    # ข้อสังเกตที่แอดมินควรเห็น แต่ไม่ทำให้หน้านี้ใช้ไม่ได้
    warnings: tuple[str, ...] = ()
    # ปัญหาที่ต้องให้แอดมินตัดสินก่อนหน้านี้จะเดินต่อได้ (เช่นปีบนหน้าไม่ตรงกับรอบนำเข้า)
    errors: tuple[str, ...] = ()


# อักขระล่องหนที่ติดมากับชื่อในไฟล์จริง — มองไม่เห็นด้วยตา แต่ทำให้ตรวจรูปแบบไม่ผ่าน
# เจอจริงในไฟล์ HKIMO รอบคัดเลือก 6 หน้า และ BBB 4 หน้า
INVISIBLE = str.maketrans("", "", "\u200b\u200c\u200d\ufeff\u00ad")

# ชื่อบนเกียรติบัตรเป็นอังกฤษพิมพ์ใหญ่ล้วน แต่ของจริงมีวงเล็บด้วย
# เช่นชื่อที่ใส่ชื่อเล่นไว้ในวงเล็บ
NAME_PATTERN = re.compile(r"[A-Z][A-Z .'\-()]+")


class CertificateProfile:
    """โปรไฟล์ตั้งต้น = โครงหน้าแบบ HKIMO ซึ่งรายการส่วนใหญ่ใช้ร่วมกัน

    โครงหน้าจริง (ลำดับบรรทัดที่ get_text คืนมา):

        Gold Award                                   <- รางวัล (Perfect Score และ Heat ส่วนใหญ่ไม่มี)
        This is awarded to
        SOMCHAI JAIDEE                               <- ชื่อ
        from THAILAND                                <- Final = ประเทศ, Heat = โรงเรียน
        for outstanding achievement in PRIMARY 3,    <- ระดับชั้น
        ... Olympiad Final Round 2026,               <- รอบ + ปี (บางรายการเป็นช่วงปี 2025 - 2026)
        Cert No: 900101                              <- เลขผู้เข้าสอบ

    รายการที่ต่างจริงให้ override เฉพาะเมธอดที่ต่าง ไม่ต้องเขียนใหม่ทั้งตัว
    """

    name_anchor = "This is awarded to"
    from_prefix = "from "
    level_prefix = "for outstanding achievement in"
    cert_no_pattern = re.compile(r"(?:Cert\s+)?No:\s*(\d+)")
    # ต้องมีช่องว่างก่อน "Award" และตัวพิมพ์ต้องตรง — ชื่อคนบางชื่อลงท้ายด้วยตัวอักษร AWARD
    # (ของจริงเจอใน HKICO) ถ้าหลวมกว่านี้ชื่อคนจะถูกอ่านเป็นบรรทัดรางวัล
    award_line_pattern = re.compile(r"^(.+?)\s+Award$")
    round_year_pattern = re.compile(
        r"\b(Final|Heat)\s+Round\s+(\d{4})(?:\s*[-–]\s*(\d{4}))?", re.IGNORECASE
    )

    def __init__(
        self,
        program: str,
        exam_round: str,
        *,
        from_field: FromField,
        nationality_policy: NationalityPolicy,
    ) -> None:
        self.program = program
        self.round = exam_round
        self.key = f"{program}_{exam_round}"
        self.from_field = from_field
        self.nationality_policy = nationality_policy

    def __repr__(self) -> str:
        return f"<{type(self).__name__} {self.key}>"

    # ------------------------------------------------------------ แคตตาล็อก

    @property
    def catalog(self) -> AwardCatalog:
        """รางวัลที่ยอมรับในรอบนี้ — มาจากไฟล์ JSON กลาง ไม่ได้เขียนไว้ในโค้ด"""
        from .manifest import load_manifests

        return load_manifests().catalog(self.program, self.round)

    @property
    def path_policy(self) -> PathPolicy:
        from .manifest import load_manifests

        return load_manifests().path_policy(self.program, self.round)

    # ------------------------------------------------------------ อ่านหน้า

    def parse(self, text: str, batch_year: int | None = None) -> ParsedCertificate:
        """อ่านหน้า 1 หน้าตามกติกาของโปรไฟล์นี้

        batch_year = ปีของรอบนำเข้า ใช้ตรวจว่าหน้านี้เป็นของรอบนี้จริง
        """
        from .common import page_lines

        lines = page_lines(text)
        name = self.extract_name(lines)
        level, level_extra = self.extract_level(lines)
        from_value = self.extract_from(lines)
        round_on_page, year_start, year_end = self.extract_round_year(lines)

        extra: dict[str, str] = {**level_extra, **self.extract_extra(lines)}
        if year_start and year_end and year_start != year_end:
            extra["academicYear"] = f"{year_start} - {year_end}"

        warnings: list[str] = []
        errors: list[str] = []
        self._check_round_year(round_on_page, year_start, year_end, batch_year, warnings, errors)

        school = from_value if self.from_field is FromField.SCHOOL else None
        country = from_value if self.from_field is FromField.COUNTRY else None
        return ParsedCertificate(
            name=name,
            candidate_no=self.extract_candidate_no(lines),
            level=level,
            school_on_page=school,
            country_on_page=country,
            round_on_page=round_on_page,
            year_on_page=year_end or year_start,
            award_text=self.extract_award_text(lines),
            extra=extra,
            warnings=tuple(warnings),
            errors=tuple(errors),
        )

    def nationality(self, parsed: ParsedCertificate) -> Nationality:
        """ตัดสินสัญชาติตามนโยบายของโปรไฟล์

        รอบ Final: THAILAND ไปต่อ, ประเทศอื่นข้าม, อ่านไม่ออกหรือไม่มีบรรทัด from
        ส่งให้แอดมินดู — ไม่ทิ้งเงียบ ๆ และไม่เดาว่าเป็นคนไทย
        """
        if self.nationality_policy is NationalityPolicy.ACCEPT_ALL:
            return Nationality.ACCEPT
        country = (parsed.country_on_page or "").strip(" .,").upper()
        if not country:
            return Nationality.UNVERIFIED
        return Nationality.ACCEPT if country == "THAILAND" else Nationality.FOREIGN

    # ------------------------------------------------------------ ขั้นย่อยที่ override ได้

    def extract_name(self, lines: list[str]) -> str | None:
        """ชื่อหาได้ 2 ทาง: บรรทัดถัดจาก 'This is awarded to' หรือบรรทัดก่อนบรรทัด from"""
        from .common import line_after, line_before_prefix, validate_name

        return validate_name(line_after(lines, self.name_anchor)) or validate_name(
            line_before_prefix(lines, self.from_prefix)
        )

    def extract_candidate_no(self, lines: list[str]) -> str | None:
        for line in lines:
            found = self.cert_no_pattern.search(line)
            if found:
                return (found.group(1) if found.groups() else found.group(0)).strip()
        return None

    def extract_level(self, lines: list[str]) -> tuple[str | None, dict[str, str]]:
        """ระดับชั้นจาก 'for outstanding achievement in PRIMARY 3,'"""
        for line in lines:
            if line.startswith(self.level_prefix):
                return (line[len(self.level_prefix):].strip(" ,.") or None), {}
        return None, {}

    def extract_from(self, lines: list[str]) -> str | None:
        """ค่าหลัง from — ความหมาย (โรงเรียน/ประเทศ) ขึ้นกับ from_field ของโปรไฟล์

        ของจริงมีหน้าที่บรรทัดนี้เหลือแค่คำว่า from ลอย ๆ (ต้นทางไม่ได้ใส่ค่ามา) -> None
        """
        bare = self.from_prefix.strip()
        for line in lines:
            if line.startswith(self.from_prefix) or line == bare:
                return line[len(self.from_prefix):].strip(" .,") or None
        return None

    def extract_round_year(self, lines: list[str]) -> tuple[str | None, int | None, int | None]:
        """รอบและปีจาก '... Final Round 2026' หรือ '... Heat Round 2025 - 2026'

        คืน (รอบ, ปีต้น, ปีท้าย) — ปีเดี่ยวได้ปีต้นเท่ากับปีท้าย
        """
        for line in lines:
            found = self.round_year_pattern.search(line)
            if found:
                start = int(found.group(2))
                end = int(found.group(3)) if found.group(3) else start
                return found.group(1).upper(), start, end
        return None, None, None

    def extract_award_text(self, lines: list[str]) -> str | None:
        """บรรทัดรางวัลบนหน้า เช่น 'Gold Award' -> 'Gold' — ใช้ตรวจทานเท่านั้น"""
        for line in lines:
            found = self.award_line_pattern.match(line)
            if found and found.group(1).strip():
                return found.group(1).strip()
        return None

    def extract_extra(self, lines: list[str]) -> dict[str, str]:
        """ข้อมูลเฉพาะรายการ — โปรไฟล์ตั้งต้นไม่มี"""
        return {}

    # ------------------------------------------------------------ ตรวจความสอดคล้อง

    def _check_round_year(
        self,
        round_on_page: str | None,
        year_start: int | None,
        year_end: int | None,
        batch_year: int | None,
        warnings: list[str],
        errors: list[str],
    ) -> None:
        """หน้าที่บอกรอบหรือปีไม่ตรงกับรอบนำเข้า = ไฟล์ผิดชุด ต้องให้แอดมินดูก่อน

        ไม่พบรอบ/ปีบนหน้าเป็นแค่ข้อสังเกต เพราะบางแบบฟอร์มไม่พิมพ์ (เช่นใบรางวัลพิเศษ)
        """
        if round_on_page and round_on_page != self.round:
            errors.append(f"หน้านี้พิมพ์ว่ารอบ {round_on_page} แต่รอบนำเข้านี้คือรอบ {self.round}")
        if batch_year and year_start:
            years = {year_start, year_end or year_start}
            if batch_year not in years:
                shown = f"{year_start} - {year_end}" if year_end and year_end != year_start else str(year_start)
                errors.append(f"หน้านี้พิมพ์ปี {shown} แต่รอบนำเข้านี้คือปี {batch_year}")
        if not round_on_page and not year_start:
            warnings.append("อ่านรอบและปีจากหน้านี้ไม่ได้")
