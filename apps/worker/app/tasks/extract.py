"""อ่านข้อความและลายนิ้วมือของหน้าเกียรติบัตร

กติกาการอ่านชื่อ เลข ระดับชั้น ฯลฯ ย้ายไปอยู่ในโปรไฟล์รายรายการสอบแล้ว (app/certificate_profiles/)
ไฟล์นี้เหลือเฉพาะส่วนที่ทุกโปรไฟล์ใช้เหมือนกัน คือดึงข้อความดิบออกจากหน้า PDF
"""

import hashlib
from typing import Any


def page_text(page: Any) -> str:
    """ข้อความดิบทั้งหน้า — เก็บลง staging_pages.raw_text ไว้ให้แอดมินตรวจย้อนหลัง"""
    return page.get_text("text") or ""


def page_fingerprint(page: Any, text: str) -> str:
    """ลายนิ้วมือของหน้า — หน้าเดียวกันจากไฟล์ต้นทางเดียวกันได้ค่าเดิมทุกครั้งที่อัป

    ใช้ทั้งคำสั่งวาดหน้า (content stream) และข้อความ เพราะเกียรติบัตรที่ต้นทางแก้ชื่อแล้วส่งมาใหม่
    ต้องไม่ถูกมองว่าเป็นหน้าเดิม ส่วนหน้าเดิมที่อัปซ้ำต้องจำได้ ไม่เกิดรายการให้ตรวจซ้ำซ้อน
    """
    digest = hashlib.sha256()
    try:
        digest.update(page.read_contents() or b"")
    except Exception:  # หน้าที่ไม่มี content stream (หน้าว่าง) — ใช้ข้อความอย่างเดียวพอ
        pass
    digest.update(b"\x00")
    digest.update(text.encode("utf-8"))
    return digest.hexdigest()
