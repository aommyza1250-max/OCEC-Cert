"""โปรไฟล์เกียรติบัตรรายรายการสอบ — ดู base.py สำหรับสัญญากลาง และ registry.py สำหรับตัวเลือกโปรไฟล์"""

from .base import CertificateProfile, FromField, Nationality, NationalityPolicy, ParsedCertificate
from .manifest import AwardCatalog, AwardDef, PathPolicy, folder_key, load_manifests
from .registry import UnsupportedProfile, get_profile, registered_profiles

__all__ = [
    "AwardCatalog",
    "AwardDef",
    "CertificateProfile",
    "FromField",
    "Nationality",
    "NationalityPolicy",
    "ParsedCertificate",
    "PathPolicy",
    "UnsupportedProfile",
    "folder_key",
    "get_profile",
    "load_manifests",
    "registered_profiles",
]
