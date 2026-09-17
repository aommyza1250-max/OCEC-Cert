"""แตก ZIP แล้วตัดแยก PDF รวมเล่มเป็นไฟล์รายบุคคล + สร้างรูป preview

แอดมินอัปโหลดมาเป็น ZIP ที่แยกโฟลเดอร์ตามรางวัล (gold/, silver/, ...)
รางวัลของแต่ละหน้าจึงมาจากชื่อโฟลเดอร์ ไม่ได้มาจากข้อความบนหน้า
เพราะหน้า Perfect Score ของจริงไม่มีข้อความรางวัลพิมพ์อยู่เลย

การกรองสัญชาติขึ้นกับรอบการสอบ:
  HEAT  (รอบคัดเลือก)    ผู้เข้าสอบเป็นคนไทยทั้งหมด ตัดแยกทุกหน้า
  FINAL (รอบชิงชนะเลิศ)  ไฟล์รวมทุกประเทศ ตัดเฉพาะหน้าที่พบ "from THAILAND"

ผลลัพธ์ลงตาราง staging_pages เท่านั้น ยังไม่แตะ students/certificates
เพราะยังไม่รู้ว่าหน้าไหนเป็นของใครจนกว่าจะได้ไฟล์ Excel มาจับคู่
"""

import logging
import os
import tempfile
from typing import Any, Callable

import pymupdf

from ..config import settings
from ..db import connection, new_id
from ..normalize import name_sort_key, normalize_award, normalize_name
from ..storage import (
    certificate_pdf_key,
    certificate_stem,
    download_to_file,
    preview_key,
    unique_stem,
    upload_bytes,
)
from .extract import PageInfo, extract_name, is_thai_national, page_lines, page_text, read_lines
from .render_preview import render_webp
from .zip_bundle import Bundle, open_bundles, read_award_bundles

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]


def run_split(batch_id: str, on_progress: ProgressFn) -> dict[str, Any]:
    cfg = settings()
    batch = _load_batch(batch_id)

    if not batch["source_zip_key"]:
        raise ValueError("batch นี้ยังไม่มีไฟล์ ZIP ต้นทาง")

    program_code = batch["program_code"]
    exam_round = batch["round"]
    exam_year = batch["year"]
    filter_nationality = exam_round == "FINAL"

    log.info("เริ่มตัดแยก batch %s (%s %s %s)", batch_id, program_code, exam_round, exam_year)

    # ดาวน์โหลดลงดิสก์ ไม่ใช่หน่วยความจำ — ZIP จริงขนาดหลายร้อย MB
    with tempfile.TemporaryDirectory() as workdir:
        zip_path = os.path.join(workdir, "bundle.zip")
        download_to_file(batch["source_zip_key"], zip_path)
        bundles = read_award_bundles(zip_path)
        log.info("พบไฟล์ใน ZIP %s ไฟล์: %s", len(bundles), [b.source_file for b in bundles])

        # รันซ้ำได้: ล้างผลรอบก่อนทิ้งก่อนเสมอ
        # (certificates ที่อ้าง staging_pages เดิมจะถูกลบตาม ON DELETE CASCADE ด้วย
        #  ถ้าเคย match ไปแล้วต้อง match ใหม่หลังตัดใหม่)
        _clear_previous_pages(batch_id)

        return _process(
            batch_id, zip_path, bundles, program_code, exam_round, exam_year,
            filter_nationality, cfg, on_progress,
        )


def _process(
    batch_id: str,
    zip_path: str,
    bundles: list[Bundle],
    program_code: str,
    exam_round: str,
    exam_year: int,
    filter_nationality: bool,
    cfg: Any,
    on_progress: ProgressFn,
) -> dict[str, Any]:

    stats: dict[str, Any] = {
        "bundles": len(bundles),
        "pagesTotal": 0,
        "pagesSplit": 0,
        "foreignSkipped": 0,
        "nameNotFound": 0,
        "certNoFound": 0,
        "awardMismatch": 0,
        "roundMismatch": 0,
        "byAward": {},
    }
    used_stems: set[str] = set()
    page_number = 0
    total_pages = _count_pages(zip_path, bundles)

    with open_bundles(zip_path, bundles) as stream:
        for bundle in stream:
            with pymupdf.open(stream=bundle.data, filetype="pdf") as doc:
                for index in range(doc.page_count):
                    page_number += 1
                    stats["pagesTotal"] += 1
                    page = doc[index]
                    text = page_text(page)
                    info = _read(page, text, cfg.name_pattern)

                    if filter_nationality and not is_thai_national(text, cfg.nationality_pattern):
                        _insert_page(
                            batch_id, page_number, text, info, bundle, None, None, "SKIPPED_FOREIGN"
                        )
                        stats["foreignSkipped"] += 1
                    else:
                        _tally(stats, info, bundle, exam_round)

                        stem = unique_stem(
                            certificate_stem(
                                normalize_name(info.name or ""),
                                program_code,
                                exam_round,
                                bundle.award,
                                info.year or exam_year,
                                page_number,
                            ),
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

                        _insert_page(
                            batch_id, page_number, text, info, bundle, pdf_key, prev_key, "UNMATCHED"
                        )
                        stats["pagesSplit"] += 1

                    if page_number % 10 == 0 or page_number == total_pages:
                        on_progress({"stage": "split", "done": page_number, "total": total_pages})

    log.info("ตัดแยก batch %s เสร็จ: %s", batch_id, stats)
    return stats


def _tally(stats: dict[str, Any], info: PageInfo, bundle: Bundle, exam_round: str) -> None:
    if not info.name:
        # ยังบันทึกหน้าไว้ พร้อมไฟล์ที่ตัดแล้ว ให้แอดมินจับคู่ด้วยมือทีหลัง
        stats["nameNotFound"] += 1
    if info.cert_no:
        stats["certNoFound"] += 1

    # cross-check: รางวัลบนหน้า (ถ้ามี) ต้องตรงกับโฟลเดอร์ที่ไฟล์อยู่
    if info.award_on_page and normalize_award(info.award_on_page) != bundle.award:
        stats["awardMismatch"] += 1
    if info.round_on_page and info.round_on_page != exam_round:
        stats["roundMismatch"] += 1

    stats["byAward"][bundle.award] = stats["byAward"].get(bundle.award, 0) + 1


def _count_pages(zip_path: str, bundles: list[Bundle]) -> int:
    """นับหน้ารวมไว้ก่อน เพื่อรายงานความคืบหน้าให้แอดมินเห็นเป็นเปอร์เซ็นต์ได้"""
    total = 0
    with open_bundles(zip_path, bundles) as stream:
        for bundle in stream:
            with pymupdf.open(stream=bundle.data, filetype="pdf") as doc:
                total += doc.page_count
    return total


def _read(page: Any, text: str, name_pattern: str) -> PageInfo:
    """อ่านข้อมูลจากหน้า — ถ้าตั้ง NAME_PATTERN ไว้ ให้ใช้ชื่อจาก regex นั้นแทน"""
    info = read_lines(page_lines(text))
    if not name_pattern:
        return info
    return PageInfo(
        name=extract_name(page, name_pattern),
        level=info.level,
        cert_no=info.cert_no,
        country=info.country,
        award_on_page=info.award_on_page,
        round_on_page=info.round_on_page,
        year=info.year,
    )


def _single_page_pdf(doc: Any, index: int) -> bytes:
    """คัดหน้าเดียวออกมาเป็นไฟล์ใหม่ โดยคงคุณภาพต้นฉบับไว้ครบ (ไม่ได้แปลงเป็นภาพ)"""
    with pymupdf.open() as out:
        out.insert_pdf(doc, from_page=index, to_page=index)
        return out.tobytes(garbage=3, deflate=True)


def _load_batch(batch_id: str) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT b.id, b.source_zip_key, p.code AS program_code, e.round, e.year
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
    bundle: Bundle,
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
               cert_no, level, award, award_on_page, cert_year, round_on_page, source_file,
               pdf_key, preview_key, match_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                bundle.award,
                info.award_on_page,
                info.year,
                info.round_on_page,
                bundle.source_file,
                pdf_key,
                prev_key,
                match_status,
            ),
        )
