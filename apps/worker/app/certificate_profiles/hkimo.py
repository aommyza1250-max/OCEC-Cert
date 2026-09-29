"""HKIMO — Hong Kong International Mathematical Olympiad

แบบฟอร์มตั้งต้นของระบบ ใช้กติกาของ CertificateProfile ตรง ๆ ไม่ต้อง override อะไร
ตรวจกับไฟล์จริงแล้ว: Final 2026 (243 หน้า) และ Heat 2026 (1,864 หน้า)
"""

from .base import CertificateProfile, FromField, NationalityPolicy


class HkimoProfile(CertificateProfile):
    pass


HKIMO_HEAT = HkimoProfile(
    "HKIMO", "HEAT", from_field=FromField.SCHOOL, nationality_policy=NationalityPolicy.ACCEPT_ALL
)
HKIMO_FINAL = HkimoProfile(
    "HKIMO", "FINAL", from_field=FromField.COUNTRY, nationality_policy=NationalityPolicy.THAILAND_ONLY
)
