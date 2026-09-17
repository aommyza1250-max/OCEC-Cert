"""ตัดแยก PDF รวมเล่มเป็นไฟล์รายบุคคล + สร้างรูป preview

รองรับทั้งสองแบบในโค้ดชุดเดียว ต่างกันแค่ขั้นกรองสัญชาติ:
  DOMESTIC      — ทุกหน้าคือคนไทย ตัดแยกทั้งหมด
  INTERNATIONAL — ตัดเฉพาะหน้าที่พบข้อความสัญชาติไทย (ปริยาย "from THAILAND")
                  หน้าของชาติอื่นบันทึกไว้เป็น SKIPPED_FOREIGN เพื่อให้ตรวจยอดได้ว่าข้ามไปกี่หน้า

ชื่อไฟล์ผลลัพธ์: {FNAME}_{LNAME}_{รหัสรายการสอบ}.pdf
ซึ่งเป็นรูปแบบเดียวกับที่ใช้อยู่เดิมตอนตัดไฟล์ด้วยมือ

ผลลัพธ์ลงตาราง staging_pages เท่านั้น ยังไม่แตะ students/certificates
เพราะยังไม่รู้ว่าหน้าไหนเป็นของใครจนกว่าจะได้ไฟล์ Excel มาจับคู่
"""

import logging
from typing import Any, Callable

import pymupdf

from ..config import settings
from ..db import connection, new_id
from ..normalize import name_sort_key, normalize_name
from ..storage import (
    certificate_pdf_key,
    certificate_stem,
    download_bytes,
    preview_key,
    unique_stem,
    upload_bytes,
)
from .extract import PageInfo, extract_name, is_thai_national, page_lines, page_text, read_lines
from .render_preview import render_webp

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]


def run_split(batch_id: str, on_progress: ProgressFn) -> dict[str, Any]:
    cfg = settings()
    batch = _load_batch(batch_id)

    if not batch["source_pdf_key"]:
        raise ValueError("batch นี้ยังไม่มีไฟล์ PDF ต้นทาง")

    exam_code = batch["exam_code"]
    international = batch["kind"] == "INTERNATIONAL"
    log.info("เริ่มตัดแยก batch %s (%s / %s)", batch_id, batch["kind"], exam_code)

    pdf_bytes = download_bytes(batch["source_pdf_key"])

    # รันซ้ำได้: ล้างผลรอบก่อนทิ้งก่อนเสมอ
    # (certificates ที่อ้าง staging_pages เดิมจะถูกลบตาม ON DELETE CASCADE ด้วย
    #  ถ้าเคย match ไปแล้วต้อง match ใหม่หลังตัดใหม่)
    _clear_previous_pages(batch_id)

    stats = {
        "pagesTotal": 0,
        "pagesSplit": 0,
        "foreignSkipped": 0,
        "nameNotFound": 0,
        "certNoFound": 0,
    }
    used_stems: set[str] = set()

    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        stats["pagesTotal"] = doc.page_count

        for index in range(doc.page_count):
            page = doc[index]
            page_number = index + 1
            text = page_text(page)
            info = _read(page, text, cfg.name_pattern)

            if international and not is_thai_national(text, cfg.nationality_pattern):
                _insert_page(batch_id, page_number, text, info, None, None, "SKIPPED_FOREIGN")
                stats["foreignSkipped"] += 1
            else:
                if not info.name:
                    # ยังบันทึกหน้าไว้ พร้อมไฟล์ที่ตัดแล้ว ให้แอดมินจับคู่ด้วยมือทีหลัง
                    stats["nameNotFound"] += 1
                if info.cert_no:
                    stats["certNoFound"] += 1

                stem = unique_stem(
                    certificate_stem(normalize_name(info.name or ""), exam_code, page_number),
                    used_stems,
                )
                pdf_key = certificate_pdf_key(batch_id, stem)
                prev_key = preview_key(batch_id, stem)

                upload_bytes(pdf_key, _single_page_pdf(doc, index), "application/pdf")
                upload_bytes(
                    prev_key,
                    render_webp(page, cfg.preview_dpi, cfg.preview_quality),
                    "image/webp",
                )

                _insert_page(batch_id, page_number, text, info, pdf_key, prev_key, "UNMATCHED")
                stats["pagesSplit"] += 1

            if page_number % 10 == 0 or page_number == doc.page_count:
                on_progress({"stage": "split", "done": page_number, "total": doc.page_count})

    log.info("ตัดแยก batch %s เสร็จ: %s", batch_id, stats)
    return stats


def _read(page: Any, text: str, name_pattern: str) -> PageInfo:
    """อ่านข้อมูลจากหน้า — ถ้าตั้ง NAME_PATTERN ไว้ ให้ใช้ชื่อจาก regex นั้นแทน"""
    info = read_lines(page_lines(text))
    if not name_pattern:
        return info
    override = extract_name(page, name_pattern)
    return PageInfo(name=override, level=info.level, cert_no=info.cert_no, country=info.country)


def _single_page_pdf(doc: Any, index: int) -> bytes:
    """คัดหน้าเดียวออกมาเป็นไฟล์ใหม่ โดยคงคุณภาพต้นฉบับไว้ครบ (ไม่ได้แปลงเป็นภาพ)"""
    with pymupdf.open() as out:
        out.insert_pdf(doc, from_page=index, to_page=index)
        return out.tobytes(garbage=3, deflate=True)


def _load_batch(batch_id: str) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT b.id, b.source_pdf_key, p.code AS exam_code, p.kind
            FROM batches b
            JOIN exams e ON e.id = b.exam_id
            JOIN exam_programs p ON p.id = e.program_id
            WHERE b.id = %s
            """,
            (batch_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"ไม่พบ batch {batch_id}")
    return row


def _clear_previous_pages(batch_id: str) -> None:
    with connection() as conn:
        conn.execute("DELETE FROM staging_pages WHERE batch_id = %s", (batch_id,))


def _insert_page(
    batch_id: str,
    page_number: int,
    raw_text: str,
    info: PageInfo,
    pdf_key: str | None,
    prev_key: str | None,
    match_status: str,
) -> None:
    normalized = normalize_name(info.name or "") or None
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO staging_pages
              (id, batch_id, page_number, raw_text, extracted_name,
               extracted_name_normalized, extracted_name_sort_key,
               cert_no, level, pdf_key, preview_key, match_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                new_id(),
                batch_id,
                page_number,
                raw_text,
                info.name,
                normalized,
                name_sort_key(info.name or "") or None,
                info.cert_no,
                info.level,
                pdf_key,
                prev_key,
                match_status,
            ),
        )
