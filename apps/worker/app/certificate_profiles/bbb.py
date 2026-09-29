"""BBB — Guangdong-Hong Kong-Macao Greater Bay Area Mathematical Olympiad (粵港澳大灣區數學競賽)

ต่างจากแบบตั้งต้นสองจุด (ตรวจกับไฟล์จริง Heat 1,166 หน้า):

    1st Prize Award                      <- รางวัลพิมพ์เป็น Prize ไม่ใช่เหรียญ
    SOMCHAI JAIDEE                       <- ชื่อตามหลังบรรทัดรางวัลทันที ไม่มี "This is awarded to"
    from SAMPLE WITTAYA SCHOOL
    for outstanding achievement in KINDERGARTEN GROUP,
    ... Mathematical Olympiad Heat Round 2026
    Cert No: 5000001

ใบเข้าร่วมพิมพ์ว่า "Certificate of Participation" แทนบรรทัด "... Award"
และบางหน้าพิมพ์ติดกันเป็น "3rdPrize Award"
"""

from .base import CertificateProfile, FromField, NationalityPolicy
from .common import validate_name

PARTICIPATION_LINE = "Certificate of Participation"


class BbbProfile(CertificateProfile):
    def extract_name(self, lines: list[str]) -> str | None:
        """ไม่มี anchor — ใช้บรรทัดก่อน from ก่อน แล้วถอยไปใช้บรรทัดถัดจากบรรทัดรางวัล"""
        from_line = super().extract_name(lines)
        if from_line:
            return from_line
        for index, line in enumerate(lines[:-1]):
            if line == PARTICIPATION_LINE or self.award_line_pattern.match(line):
                return validate_name(lines[index + 1])
        return None

    def extract_award_text(self, lines: list[str]) -> str | None:
        if PARTICIPATION_LINE in lines:
            return PARTICIPATION_LINE
        return super().extract_award_text(lines)


BBB_HEAT = BbbProfile(
    "BBB", "HEAT", from_field=FromField.SCHOOL, nationality_policy=NationalityPolicy.ACCEPT_ALL
)
BBB_FINAL = BbbProfile(
    "BBB", "FINAL", from_field=FromField.COUNTRY, nationality_policy=NationalityPolicy.THAILAND_ONLY
)
