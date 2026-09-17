"""อ่าน/เขียนไฟล์บน Cloudflare R2 (dev ใช้ MinIO ซึ่งเป็น S3-compatible)"""

import io
import re
from functools import lru_cache

import boto3
from botocore.config import Config

from .config import settings


@lru_cache(maxsize=1)
def _client():
    s = settings()
    return boto3.client(
        "s3",
        endpoint_url=s.r2_endpoint,
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name=s.aws_region,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if s.r2_force_path_style else "auto"},
        ),
    )


def download_bytes(key: str) -> bytes:
    buffer = io.BytesIO()
    _client().download_fileobj(settings().r2_bucket, key, buffer)
    return buffer.getvalue()


def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    _client().put_object(
        Bucket=settings().r2_bucket, Key=key, Body=data, ContentType=content_type
    )


def certificate_pdf_key(batch_id: str, stem: str) -> str:
    return f"certificates/{batch_id}/{stem}.pdf"


def preview_key(batch_id: str, stem: str) -> str:
    # prefix previews/ ถูกตั้งให้อ่านสาธารณะได้ เพื่อให้เสิร์ฟผ่าน CDN ตรง ๆ
    return f"previews/{batch_id}/{stem}.webp"


def safe_part(text: str) -> str:
    """ทำข้อความให้ใช้เป็นส่วนหนึ่งของชื่อไฟล์ได้

    ตรรกะเดียวกับสคริปต์ rename_pdf_text.py ที่ใช้กับไฟล์จริง:
    ตัดอักขระที่ระบบไฟล์ไม่ชอบทิ้ง แล้วแทนช่องว่าง/ยัติภังค์ด้วย _
    ต่างตรงที่ตัด apostrophe ออกด้วย เพราะไฟล์นี้ต้องไปเป็น object key บน R2
    """
    cleaned = re.sub(r"[\\/:*?\"<>|.\']", "", text).strip()
    cleaned = re.sub(r"[\s\-]+", "_", cleaned)
    return cleaned


def certificate_stem(name_normalized: str, exam_code: str, page_number: int) -> str:
    """ชื่อไฟล์ตามรูปแบบที่ใช้อยู่เดิม: {FNAME}_{LNAME}_{รายการสอบ}

    ส่วน "รายการสอบ" เดิมมาจากชื่อโฟลเดอร์ที่เก็บไฟล์
    ตอนนี้มาจากรหัสรายการสอบที่แอดมินเลือกตอนสร้างรอบนำเข้า
    หน้าที่อ่านชื่อไม่ออกจะได้ชื่อไฟล์เป็นเลขหน้าแทน เพื่อให้ยังมีไฟล์ให้แอดมินไปจับคู่เองได้
    """
    name_part = safe_part(name_normalized) if name_normalized else ""
    code_part = safe_part(exam_code) or "UNKNOWN"
    if not name_part:
        return f"PAGE_{page_number:04d}_{code_part}"
    return f"{name_part}_{code_part}"


def unique_stem(stem: str, used: set[str]) -> str:
    """กันชื่อไฟล์ชนกันภายในรอบนำเข้าเดียวกัน — คนชื่อซ้ำจะได้ _2, _3 ต่อท้าย"""
    candidate, n = stem, 2
    while candidate in used:
        candidate = f"{stem}_{n}"
        n += 1
    used.add(candidate)
    return candidate
