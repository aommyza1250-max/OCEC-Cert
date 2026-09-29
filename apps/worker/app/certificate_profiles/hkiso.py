"""HKISO — Hong Kong International Science Olympiad

ต่างจากแบบตั้งต้น (ตรวจกับไฟล์จริงรอบ Final):

  - ใบรางวัลพิเศษ (Experiment) ใช้อีกแบบฟอร์ม ไม่มี "for outstanding achievement in":
        achieved CHAMPION in PRIMARY 3,
        Hong Kong International Science Olympiad Experiment 2025 - 2026,
  - ปีพิมพ์เป็นช่วงปีการศึกษา: "Final Round 2025 - 2026"
  - รอบ Heat ต้นทางซอยโฟลเดอร์ระดับชั้นไว้ใต้โฟลเดอร์รางวัล (Gold/P3/) — ประกาศไว้ใน
    shared/certificate-profiles/hkiso.json (levelSubfolder) ไม่ได้อยู่ในโค้ดนี้
"""

from .base import CertificateProfile, FromField, NationalityPolicy
from .common import ACHIEVED_PREFIX, event_name, event_year, split_achievement


class HkisoProfile(CertificateProfile):
    def extract_level(self, lines: list[str]) -> tuple[str | None, dict[str, str]]:
        level, extra = super().extract_level(lines)
        if level:
            return level, extra
        for line in lines:
            if line.startswith(ACHIEVED_PREFIX):
                achievement, rest = split_achievement(line)
                return (rest or None), ({"achievement": achievement} if achievement else {})
        return None, {}

    def extract_round_year(self, lines: list[str]) -> tuple[str | None, int | None, int | None]:
        found = super().extract_round_year(lines)
        return found if found[1] else event_year(lines)

    def extract_extra(self, lines: list[str]) -> dict[str, str]:
        return event_name(lines)


HKISO_HEAT = HkisoProfile(
    "HKISO", "HEAT", from_field=FromField.SCHOOL, nationality_policy=NationalityPolicy.ACCEPT_ALL
)
HKISO_FINAL = HkisoProfile(
    "HKISO", "FINAL", from_field=FromField.COUNTRY, nationality_policy=NationalityPolicy.THAILAND_ONLY
)
