"""ค่าตั้งต้นทั้งหมดของ worker อ่านจาก environment"""

import os
from dataclasses import dataclass, field
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"ไม่ได้ตั้งค่า environment '{name}' — ดูรายการทั้งหมดที่ .env.example")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str

    r2_endpoint: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str
    r2_force_path_style: bool

    worker_shared_secret: str

    # ---- รูปแบบข้อความบนหน้าเกียรติบัตร (อ้างอิงจากไฟล์จริง ดู docs/pdf-parsing-notes.md) ----
    # ข้อความบอกสัญชาติในเกียรติบัตรรวมประเทศ
    nationality_pattern: str = r"from\s+THAILAND"
    # บรรทัดสัญชาติ — ชื่อผู้รับอยู่บรรทัด "ก่อน" บรรทัดนี้
    country_line_prefix: str = "from "
    # ข้อความนำหน้าชื่อ — ชื่อผู้รับอยู่บรรทัด "ถัดจาก" บรรทัดนี้
    name_anchor: str = "This is awarded to"
    # ข้อความนำหน้าระดับชั้น
    level_line_prefix: str = "for outstanding achievement in"
    # เลขบนหน้ากระดาษ ของจริงเขียน "Cert No: 203297"
    cert_no_pattern: str = r"(?:Cert\s+)?No:\s*(\d+)"
    # บรรทัดรางวัล ของจริงเขียน "Gold Award" — หน้า Perfect Score ไม่มีบรรทัดนี้
    award_line_pattern: str = r"^(.+?)\s+Award$"
    # รอบและปี ของจริงเขียน "... Olympiad Final Round 2026,"
    round_year_pattern: str = r"(Final|Heat)\s+Round\s+(\d{4})"
    # ชื่อบนเกียรติบัตรเป็นอังกฤษพิมพ์ใหญ่ล้วน ใช้ตรวจว่าหยิบถูกบรรทัดไหม
    name_validation_pattern: str = r"[A-Z][A-Z .\'\-]+"

    # ใส่ regex ที่มี capture group เดียวเพื่อข้ามตรรกะ anchor ทั้งหมด (เผื่อแบบฟอร์มต่างออกไปมาก)
    name_pattern: str = ""

    preview_dpi: int = 110
    preview_quality: int = 80

    poll_interval_sec: float = 2.0
    max_attempts: int = 3

    aws_region: str = field(default="auto")


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings(
        database_url=_require("DATABASE_URL"),
        r2_endpoint=_require("R2_ENDPOINT"),
        r2_access_key_id=_require("R2_ACCESS_KEY_ID"),
        r2_secret_access_key=_require("R2_SECRET_ACCESS_KEY"),
        r2_bucket=_require("R2_BUCKET"),
        r2_force_path_style=os.environ.get("R2_FORCE_PATH_STYLE", "false") == "true",
        worker_shared_secret=_require("WORKER_SHARED_SECRET"),
        nationality_pattern=os.environ.get("NATIONALITY_PATTERN", r"from\s+THAILAND"),
        country_line_prefix=os.environ.get("COUNTRY_LINE_PREFIX", "from "),
        name_anchor=os.environ.get("NAME_ANCHOR", "This is awarded to"),
        level_line_prefix=os.environ.get(
            "LEVEL_LINE_PREFIX", "for outstanding achievement in"
        ),
        cert_no_pattern=os.environ.get("CERT_NO_PATTERN", r"(?:Cert\s+)?No:\s*(\d+)"),
        award_line_pattern=os.environ.get("AWARD_LINE_PATTERN", r"^(.+?)\s+Award$"),
        round_year_pattern=os.environ.get(
            "ROUND_YEAR_PATTERN", r"(Final|Heat)\s+Round\s+(\d{4})"
        ),
        name_validation_pattern=os.environ.get(
            "NAME_VALIDATION_PATTERN", r"[A-Z][A-Z .\'\-]+"
        ),
        name_pattern=os.environ.get("NAME_PATTERN", ""),
        preview_dpi=int(os.environ.get("PREVIEW_DPI", "110")),
        preview_quality=int(os.environ.get("PREVIEW_QUALITY", "80")),
        poll_interval_sec=float(os.environ.get("POLL_INTERVAL_SEC", "2.0")),
        max_attempts=int(os.environ.get("MAX_ATTEMPTS", "3")),
    )
