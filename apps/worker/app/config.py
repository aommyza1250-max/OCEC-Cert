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

    # กติกาอ่านหน้าเกียรติบัตรไม่ได้อยู่ที่นี่แล้ว — อยู่ในโปรไฟล์รายรายการสอบ
    # (app/certificate_profiles/) ตัวแปร environment ชุดเดิมอย่าง NAME_ANCHOR หรือ CERT_NO_PATTERN
    # ถูกถอดออก เพราะค่าเดียวใช้กับทุกรายการ แก้เพื่อรายการหนึ่งจะไปเปลี่ยนผลของรายการอื่นเงียบ ๆ

    # 72 DPI = 841x595 px เท่าขนาดกระดาษ A4 นอนพอดี ไฟล์ราว 85 KB/ใบ
    # มือถือจอกว้าง 390px แสดงที่ 2 เท่า กดดูเต็มจอยังอ่านชื่อและเลขได้ครบ
    # ใหญ่กว่านี้ไม่ได้ช่วยให้อ่านง่ายขึ้น แต่ทำให้หน้าผลค้นหาหนักขึ้นเป็นเท่าตัว
    # (110 DPI ของเดิมได้ไฟล์ 242 KB/ใบ คนที่มี 4 ใบต้องโหลดเกือบ 1 MB)
    # เปิดการลบเกียรติบัตรที่ครบอายุการเก็บโดยอัตโนมัติ
    # ปิดไว้เป็นค่าตั้งต้นโดยตั้งใจ — งานนี้ลบไฟล์จริงและย้อนกลับไม่ได้
    # เปิดเมื่อลอง dry-run แล้วเห็นว่ารายการที่จะลบถูกต้องเท่านั้น
    retention_enabled: bool = False

    # รอกี่วันหลังเผยแพร่ ก่อนลบไฟล์ต้นฉบับ (ZIP) ทิ้ง — 0 = ลบทันทีที่ครบเงื่อนไข
    # ต้นฉบับยังอยู่ในเครื่องแอดมินที่อัปขึ้นมา R2 ไม่ใช่สำเนาเดียว
    source_keep_days: int = 0

    preview_dpi: int = 72
    preview_quality: int = 75

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
        retention_enabled=os.environ.get("RETENTION_ENABLED", "").lower() == "true",
        source_keep_days=int(os.environ.get("SOURCE_ZIP_KEEP_DAYS", "0")),
        preview_dpi=int(os.environ.get("PREVIEW_DPI", "72")),
        preview_quality=int(os.environ.get("PREVIEW_QUALITY", "75")),
        poll_interval_sec=float(os.environ.get("POLL_INTERVAL_SEC", "2.0")),
        max_attempts=int(os.environ.get("MAX_ATTEMPTS", "3")),
    )
