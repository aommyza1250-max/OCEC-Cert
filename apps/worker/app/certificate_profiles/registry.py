"""เลือกโปรไฟล์จาก (รหัสรายการสอบ, รอบ) — เป็นตัวเลือก ไม่ใช่ตัวอ่าน

คู่ที่ไม่มีโปรไฟล์ = ปฏิเสธตั้งแต่ต้น ไม่มีโปรไฟล์กลางให้ถอยไปใช้แบบเงียบ ๆ
เพราะอ่านหน้าด้วยกติกาผิดรายการ = ได้ชื่อผิดคนหรือรางวัลผิดโดยไม่มีอะไรฟ้อง

อยากเพิ่มรายการใหม่: เขียนโมดูลโปรไฟล์ + ไฟล์ JSON ใน shared/certificate-profiles/
แล้วใส่ไว้ใน PROFILES ด้านล่าง — เทสจะฟ้องถ้าสองฝั่งไม่ครบคู่กัน
"""

from .base import CertificateProfile
from .bbb import BBB_FINAL, BBB_HEAT
from .hkico import HKICO_FINAL, HKICO_HEAT
from .hkimo import HKIMO_FINAL, HKIMO_HEAT
from .hkiso import HKISO_FINAL, HKISO_HEAT
from .timo import TIMO_FINAL, TIMO_HEAT

PROFILES: dict[tuple[str, str], CertificateProfile] = {
    (p.program, p.round): p
    for p in (
        HKIMO_HEAT, HKIMO_FINAL,
        TIMO_HEAT, TIMO_FINAL,
        BBB_HEAT, BBB_FINAL,
        HKICO_HEAT, HKICO_FINAL,
        HKISO_HEAT, HKISO_FINAL,
    )
}


class UnsupportedProfile(ValueError):
    """ไม่มีโปรไฟล์ของรายการสอบ/รอบนี้ — เป็นความผิดพลาดที่ผู้ใช้แก้ได้ (เลือกรายการผิด)"""


def get_profile(program: str, exam_round: str) -> CertificateProfile:
    profile = PROFILES.get(((program or "").upper(), (exam_round or "").upper()))
    if profile is None:
        raise UnsupportedProfile(
            f"ระบบยังไม่รองรับเกียรติบัตรของ {program} รอบ {exam_round} "
            "— ต้องเพิ่มโปรไฟล์ในโค้ดก่อนจึงจะนำเข้าได้"
        )
    return profile


def registered_profiles() -> list[CertificateProfile]:
    return list(PROFILES.values())
