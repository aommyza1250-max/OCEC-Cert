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


def download_to_file(key: str, path: str) -> None:
    """ดาวน์โหลดลงดิสก์แทนการอมไว้ในหน่วยความจำ

    ไฟล์ ZIP เกียรติบัตรจริงมีขนาดหลายร้อย MB (ของจริงที่ทดสอบ 359 MB)
    ถ้าโหลดเข้าหน่วยความจำทั้งก้อนแล้วยังต้องอม PDF ข้างในอีก worker จะถูกฆ่าเพราะแรมไม่พอ
    """
    _client().download_file(settings().r2_bucket, key, path)


def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    _client().put_object(
        Bucket=settings().r2_bucket, Key=key, Body=data, ContentType=content_type
    )


def list_keys(prefix: str) -> list[dict]:
    """คืนรายการไฟล์ทั้งหมดใต้ prefix พร้อมขนาด

    วนดึงทีละหน้า (1000 ไฟล์) จนครบ เพราะรอบนำเข้าหนึ่งมีไฟล์หลายร้อยชิ้น
    """
    client = _client()
    bucket = settings().r2_bucket
    out: list[dict] = []
    token: str | None = None

    while True:
        kwargs: dict = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        out.extend({"key": o["Key"], "size": o["Size"]} for o in page.get("Contents", []))
        if not page.get("IsTruncated"):
            return out
        token = page["NextContinuationToken"]


def delete_keys(keys: list[str]) -> int:
    """ลบไฟล์เป็นชุด ทีละ 1000 คีย์ต่อคำสั่ง (ขีดจำกัดของ S3 API)

    ไฟล์ที่ไม่มีอยู่แล้วถือว่าสำเร็จ — ตัวลบต้องรันซ้ำได้โดยไม่พัง
    """
    if not keys:
        return 0

    client = _client()
    bucket = settings().r2_bucket
    deleted = 0
    for start in range(0, len(keys), 1000):
        chunk = keys[start : start + 1000]
        result = client.delete_objects(
            Bucket=bucket, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True}
        )
        errors = result.get("Errors") or []
        if errors:
            raise RuntimeError(f"ลบไฟล์ไม่สำเร็จ {len(errors)} ชิ้น เช่น {errors[0]}")
        deleted += len(chunk)
    return deleted


def certificate_pdf_key(batch_id: str, stem: str, job_id: str | None = None) -> str:
    """ไฟล์ของเกียรติบัตรรายคน — ใส่ job_id ไว้ใน path เพื่อให้ย้อนงานที่พังได้ทั้งก้อน

    งานที่ตายกลางทางทิ้งไฟล์ไว้ครึ่งหนึ่งเสมอ ถ้ารู้ prefix ของงานนั้น ลบทีเดียวก็สะอาด
    ไม่ต้องไล่เดาว่าไฟล์ไหนมีแถวในฐานข้อมูลอ้างอยู่หรือไม่
    """
    folder = f"{batch_id}/{job_id}" if job_id else batch_id
    return f"certificates/{folder}/{stem}.pdf"


def preview_key(batch_id: str, stem: str, job_id: str | None = None) -> str:
    # prefix previews/ ถูกตั้งให้อ่านสาธารณะได้ เพื่อให้เสิร์ฟผ่าน CDN ตรง ๆ
    folder = f"{batch_id}/{job_id}" if job_id else batch_id
    return f"previews/{folder}/{stem}.webp"


def job_output_prefixes(batch_id: str, job_id: str) -> list[str]:
    """prefix ของไฟล์ทั้งหมดที่งานนี้สร้าง — ใช้ย้อนงานที่พัง"""
    return [f"certificates/{batch_id}/{job_id}/", f"previews/{batch_id}/{job_id}/"]


def safe_part(text: str) -> str:
    """ทำข้อความให้ใช้เป็นส่วนหนึ่งของชื่อไฟล์ได้

    ตรรกะเดียวกับสคริปต์ rename_pdf_text.py ที่ใช้กับไฟล์จริง:
    ตัดอักขระที่ระบบไฟล์ไม่ชอบทิ้ง แล้วแทนช่องว่าง/ยัติภังค์ด้วย _
    ต่างตรงที่ตัด apostrophe ออกด้วย เพราะไฟล์นี้ต้องไปเป็น object key บน R2
    """
    cleaned = re.sub(r"[\\/:*?\"<>|.\']", "", text).strip()
    cleaned = re.sub(r"[\s\-]+", "_", cleaned)
    return cleaned


def certificate_stem(
    name_normalized: str,
    program_code: str,
    exam_round: str,
    award: str,
    year: int | str,
    page_number: int,
) -> str:
    """ชื่อไฟล์ตามสเปก: {FNAME}_{LNAME}_{รายการสอบ}_{รอบ}_{รางวัล}_{ปี}

    ตัวอย่าง: SOMCHAI_JAIDEE_HKIMO_FINAL_GOLD_2026

    หน้าที่อ่านชื่อไม่ออกจะได้เลขหน้าแทนชื่อ เพื่อให้ยังมีไฟล์ให้แอดมินไปจับคู่เองได้
    """
    name_part = safe_part(name_normalized) if name_normalized else f"PAGE_{page_number:04d}"
    parts = [name_part, safe_part(program_code), safe_part(exam_round), safe_part(award)]
    return "_".join([p for p in parts if p] + [str(year)])


def unique_stem(stem: str, used: set[str]) -> str:
    """กันชื่อไฟล์ชนกันภายในรอบนำเข้าเดียวกัน — คนชื่อซ้ำจะได้ _2, _3 ต่อท้าย"""
    candidate, n = stem, 2
    while candidate in used:
        candidate = f"{stem}_{n}"
        n += 1
    used.add(candidate)
    return candidate
