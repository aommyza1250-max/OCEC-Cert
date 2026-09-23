"""TIMO — Thailand International Mathematical Olympiad

โครงหน้าเหมือน HKIMO ต่างแค่พิมพ์ปีเป็นช่วงปีการศึกษา ("Heat Round 2025 - 2026")
ซึ่งกติกาตั้งต้นรองรับอยู่แล้ว ตรวจกับไฟล์จริง Heat (1,704 หน้า) — ยังไม่มีไฟล์ Final ให้ตรวจ
"""

from .base import CertificateProfile, FromField, NationalityPolicy


class TimoProfile(CertificateProfile):
    pass


TIMO_HEAT = TimoProfile(
    "TIMO", "HEAT", from_field=FromField.SCHOOL, nationality_policy=NationalityPolicy.ACCEPT_ALL
)
TIMO_FINAL = TimoProfile(
    "TIMO", "FINAL", from_field=FromField.COUNTRY, nationality_policy=NationalityPolicy.THAILAND_ONLY
)
