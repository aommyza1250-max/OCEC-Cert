"""HKICO — Hong Kong International Computational Olympiad

ต่างจากแบบตั้งต้น (ตรวจกับไฟล์จริง Heat 439 หน้า และใบรางวัลพิเศษรอบ Final):

  - ระดับชั้นมีภาษาโปรแกรมต่อท้าย: "for outstanding achievement in PRIMARY 2 in SCRATCH,"
    แยกเก็บวิชาไว้ใน extra เพราะชีทรายชื่อเขียนแค่ระดับชั้น
  - ปีพิมพ์เป็นช่วงปีการศึกษา: "Heat Round 2025 - 2026"
  - ใบรางวัลพิเศษรอบ Final (Project) ใช้อีกแบบฟอร์ม:
        achieved CHAMPION in PRIMARY 5 in BLOCKLY,
        Hong Kong International Computational Olympiad Project 2025 - 2026,
"""

from .base import CertificateProfile, FromField, NationalityPolicy
from .common import ACHIEVED_PREFIX, event_name, event_year, split_achievement, split_subject


class HkicoProfile(CertificateProfile):
    def extract_level(self, lines: list[str]) -> tuple[str | None, dict[str, str]]:
        for line in lines:
            if line.startswith(self.level_prefix):
                level, subject = split_subject(line[len(self.level_prefix):].strip(" ,."))
                return (level or None), ({"subject": subject} if subject else {})
            if line.startswith(ACHIEVED_PREFIX):
                achievement, rest = split_achievement(line)
                level, subject = split_subject(rest)
                extra = {"achievement": achievement} if achievement else {}
                if subject:
                    extra["subject"] = subject
                return (level or None), extra
        return None, {}

    def extract_round_year(self, lines: list[str]) -> tuple[str | None, int | None, int | None]:
        found = super().extract_round_year(lines)
        if found[1]:
            return found
        return event_year(lines)

    def extract_extra(self, lines: list[str]) -> dict[str, str]:
        return event_name(lines)


HKICO_HEAT = HkicoProfile(
    "HKICO", "HEAT", from_field=FromField.SCHOOL, nationality_policy=NationalityPolicy.ACCEPT_ALL
)
HKICO_FINAL = HkicoProfile(
    "HKICO", "FINAL", from_field=FromField.COUNTRY, nationality_policy=NationalityPolicy.THAILAND_ONLY
)
