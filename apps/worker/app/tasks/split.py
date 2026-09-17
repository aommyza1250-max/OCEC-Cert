"""แตก ZIP แล้วตัดแยก PDF รวมเล่มเป็นไฟล์รายบุคคล + สร้างรูป preview

แอดมินอัปโหลดมาเป็น ZIP ที่แยกโฟลเดอร์ตามรางวัล (gold/, silver/, ...)
รางวัลของแต่ละหน้าจึงมาจากชื่อโฟลเดอร์ ไม่ได้มาจากข้อความบนหน้า
เพราะหน้า Perfect Score ของจริงไม่มีข้อความรางวัลพิมพ์อยู่เลย

การกรองสัญชาติขึ้นกับรอบการสอบ:
  HEAT  (รอบคัดเลือก)    ผู้เข้าสอบเป็นคนไทยทั้งหมด ตัดแยกทุกหน้า
  FINAL (รอบชิงชนะเลิศ)  ไฟล์รวมทุกประเทศ ตัดเฉพาะหน้าที่พบ "from THAILAND"

มี 2 โหมด:
  replace  ตัดใหม่ทั้งรอบ ลบผลเดิมทิ้งก่อน — ใช้ตอนอัปโหลดครั้งแรก หรือตอนไฟล์ชุดเดิมผิด
  append   เติมไฟล์ที่ตกหล่นเข้ารอบเดิม หน้าที่มีอยู่แล้วไม่ถูกแตะ
           หน้าที่ซ้ำกับที่นำเข้าไปแล้วจะถูกข้าม โดยดูจาก (เลขผู้เข้าสอบ + รางวัล)

ทำไมต้องดูทั้งเลขและรางวัลคู่กัน: คนเดียวได้หลายใบคนละรางวัลเป็นเรื่องปกติ
ของจริงเคยเจอว่าต้นทางส่งใบ Perfect Score มาให้ แต่ใบ Gold ของคนเดียวกันหายไป
พอทวงแล้วได้ใบ Gold ตามมา ถ้าตรวจซ้ำด้วยเลขอย่างเดียว ใบ Gold จะถูกมองว่าซ้ำแล้วโดนทิ้ง

ผลลัพธ์ลงตาราง staging_pages เท่านั้น ยังไม่แตะ students/certificates
เพราะยังไม่รู้ว่าหน้าไหนเป็นของใครจนกว่าจะได้ไฟล์ Excel มาจับคู่
"""

import logging
import os
import tempfile
import zipfile
from dataclasses import dataclass, replace
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


def run_split(
    batch_id: str, on_progress: ProgressFn, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    cfg = settings()
    batch = _load_batch(batch_id)
    payload = payload or {}

    append = payload.get("mode") == "append"
    pdf_key = payload.get("pdfKey")
    zip_key = payload.get("zipKey") or (None if pdf_key else batch["source_zip_key"])

    if not pdf_key and not zip_key:
        raise ValueError("batch นี้ยังไม่มีไฟล์ ZIP ต้นทาง")

    program_code = batch["program_code"]
    exam_round = batch["round"]
    exam_year = batch["year"]
    filter_nationality = exam_round == "FINAL"

    log.info(
        "เริ่มตัดแยก batch %s (%s %s %s) โหมด %s",
        batch_id, program_code, exam_round, exam_year, "append" if append else "replace",
    )

    # ดาวน์โหลดลงดิสก์ ไม่ใช่หน่วยความจำ — ZIP จริงขนาดหลายร้อย MB
    with tempfile.TemporaryDirectory() as workdir:
        if pdf_key:
            # เติมไฟล์ของคนที่ตกหล่นทีละใบ — แอดมินโยน PDF เข้ามาตรง ๆ ไม่ต้องอัด ZIP
            source_path, bundles = _prepare_single_pdf(workdir, pdf_key, payload)
        else:
            source_path = os.path.join(workdir, "bundle.zip")
            download_to_file(zip_key, source_path)
            bundles = read_award_bundles(source_path)
            log.info("พบไฟล์ใน ZIP %s ไฟล์: %s", len(bundles), [b.source_file for b in bundles])

        if not append:
            # ตัดใหม่ทั้งรอบ: ล้างผลรอบก่อนทิ้งก่อน
            # (certificates ที่อ้าง staging_pages เดิมจะถูกลบตาม ON DELETE CASCADE ด้วย)
            _clear_previous_pages(batch_id)

        existing = _existing_state(batch_id)
        return _process(
            batch_id, source_path, bundles, program_code, exam_round, exam_year,
            filter_nationality, append, existing, cfg, on_progress,
            prefer_page_award=bool(pdf_key),
        )


def _prepare_single_pdf(
    workdir: str, pdf_key: str, payload: dict[str, Any]
) -> tuple[str, list[Bundle]]:
    """เตรียมไฟล์ PDF ใบเดียวที่แอดมินโยนเข้ามาให้คนที่ตกหล่น

    ตรวจ **ก่อน** ลงมือประมวลผล ว่าไฟล์นี้เป็นของคนที่ควรจะเป็นจริง
    ถ้าหยิบไฟล์ผิดคนแล้วปล่อยผ่าน เกียรติบัตรจะไปโผล่ในชื่อผิดคนบนหน้าเว็บ
    ตรวจก่อนจึงไม่ทิ้งไฟล์ขยะไว้บน R2 และไม่ต้องย้อนลบอะไร
    """
    pdf_path = os.path.join(workdir, "single.pdf")
    download_to_file(pdf_key, pdf_path)

    expect_cert_no = str(payload.get("expectCertNo") or "").strip()
    if expect_cert_no:
        _verify_belongs_to(pdf_path, expect_cert_no, str(payload.get("expectName") or ""))

    # ห่อเป็น ZIP ที่มีโฟลเดอร์รางวัลเดียว เพื่อให้ทางเดินหลังจากนี้เหมือนกับการอัป ZIP ทุกอย่าง
    # ไม่ต้องมีโค้ดสองทางให้ดูแล และได้ตรรกะข้ามของซ้ำกับการตั้งชื่อไฟล์เหมือนกันฟรี ๆ
    award = normalize_award(payload.get("expectedAward") or "") or "GOLD"
    name = os.path.basename(pdf_key)
    zip_path = os.path.join(workdir, "single.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(pdf_path, f"{award}/{name}")

    return zip_path, read_award_bundles(zip_path)


def _verify_belongs_to(pdf_path: str, expect_cert_no: str, expect_name: str = "") -> None:
    """ตรวจว่าไฟล์นี้เป็นของผู้เข้าสอบคนที่ควรจะเป็นจริง

    เทียบด้วย **เลขบนหน้ากระดาษ** เพราะนั่นคือสิ่งที่ผู้ปกครองถืออยู่ในมือ
    ชื่ออย่างเดียวไม่พอ คนชื่อพ้องกันมีจริง

    กรณีที่เจอบ่อย: แอดมินแก้ไฟล์เองโดยเปลี่ยนแค่ชื่อ ลืมแก้เลข
    ข้อความจึงต้องบอกให้ชัดว่าต้องแก้อะไร ไม่ใช่แค่บอกว่า "ไม่ตรง"
    """
    expect_normalized = normalize_name(expect_name)
    found: list[str] = []
    name_matched: list[str] = []

    with pymupdf.open(pdf_path) as doc:
        for index in range(doc.page_count):
            info = read_lines(page_lines(page_text(doc[index])))
            if info.cert_no == expect_cert_no:
                return
            found.append(f"{info.cert_no or 'อ่านเลขไม่ได้'} ({info.name or 'อ่านชื่อไม่ได้'})")
            if expect_normalized and normalize_name(info.name or "") == expect_normalized:
                name_matched.append(info.cert_no or "อ่านเลขไม่ได้")

    if name_matched:
        raise ValueError(
            f"ชื่อบนเกียรติบัตรตรงกับ {expect_name} แล้ว "
            f"แต่เลขบนหน้าเป็น {name_matched[0]} ซึ่งเป็นของคนอื่น "
            f"ต้องเป็น {expect_cert_no} — ถ้าแก้ไฟล์เอง อย่าลืมแก้บรรทัด Cert No ด้วย"
        )

    raise ValueError(
        f"ไฟล์นี้ไม่มีหน้าของผู้เข้าสอบเลข {expect_cert_no} "
        f"— ในไฟล์พบ: {', '.join(found) or '(ไม่มีหน้าเลย)'} "
        "กรุณาตรวจว่าหยิบไฟล์ถูกคนหรือไม่"
    )


def _process(
    batch_id: str,
    zip_path: str,
    bundles: list[Bundle],
    program_code: str,
    exam_round: str,
    exam_year: int,
    filter_nationality: bool,
    append: bool,
    existing: "ExistingState",
    cfg: Any,
    on_progress: ProgressFn,
    prefer_page_award: bool = False,
) -> dict[str, Any]:

    stats: dict[str, Any] = {
        "mode": "append" if append else "replace",
        "bundles": len(bundles),
        "pagesTotal": 0,
        "pagesSplit": 0,
        "pagesSkippedExisting": 0,
        "foreignSkipped": 0,
        "nameNotFound": 0,
        "certNoFound": 0,
        "awardMismatch": 0,
        "roundMismatch": 0,
        "byAward": {},
    }
    # เอาชื่อไฟล์ที่ใช้ไปแล้วมาด้วย ไม่งั้นหน้าใหม่ที่ชื่อชนกันจะเขียนทับไฟล์เดิมบน R2
    used_stems: set[str] = set(existing.stems)
    page_number = existing.max_page
    total_pages = _count_pages(zip_path, bundles)

    with open_bundles(zip_path, bundles) as stream:
        for bundle in stream:
            with pymupdf.open(stream=bundle.data, filetype="pdf") as doc:
                for index in range(doc.page_count):
                    stats["pagesTotal"] += 1
                    page = doc[index]
                    text = page_text(page)
                    info = _read(page, text, cfg.name_pattern)
                    bundle = _resolve_award(bundle, info, prefer_page_award)

                    if append and _already_imported(existing, info, bundle):
                        # หน้านี้นำเข้าไปแล้ว ข้ามไปโดยไม่กินเลขหน้า
                        stats["pagesSkippedExisting"] += 1
                        continue

                    page_number += 1
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

    stats.update(_batch_totals(batch_id))
    log.info("ตัดแยก batch %s เสร็จ: %s", batch_id, stats)
    return stats


@dataclass
class ExistingState:
    """สิ่งที่มีอยู่แล้วในรอบนำเข้านี้ ใช้ตอนเติมไฟล์ที่ตกหล่น"""

    max_page: int
    stems: set[str]
    keys: set[tuple[str, str]]


def _existing_state(batch_id: str) -> ExistingState:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT page_number, pdf_key, cert_no, extracted_name_normalized, award
            FROM staging_pages WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchall()

    stems = {
        row["pdf_key"].rsplit("/", 1)[-1].removesuffix(".pdf")
        for row in rows
        if row["pdf_key"]
    }
    keys = {k for row in rows if (k := _dedupe_key(row["cert_no"],
                                                   row["extracted_name_normalized"],
                                                   row["award"]))}
    return ExistingState(
        max_page=max((r["page_number"] for r in rows), default=0),
        stems=stems,
        keys=keys,
    )


def _dedupe_key(
    cert_no: str | None, name_normalized: str | None, award: str | None
) -> tuple[str, str] | None:
    """คีย์ที่ใช้บอกว่า "หน้านี้มีอยู่แล้ว"

    ต้องมีรางวัลประกอบเสมอ เพราะคนเดียวได้หลายใบคนละรางวัลเป็นเรื่องปกติ
    ถ้าไม่มีทั้งเลขและชื่อ แปลว่าบอกไม่ได้ว่าซ้ำหรือไม่ — คืน None แล้วให้เติมเข้าไป
    ดีกว่าเผลอทิ้งใบที่ควรมี
    """
    identity = cert_no or name_normalized
    if not identity or not award:
        return None
    return (identity, award)


def _already_imported(existing: ExistingState, info: PageInfo, bundle: Bundle) -> bool:
    key = _dedupe_key(info.cert_no, normalize_name(info.name or "") or None, bundle.award)
    return key is not None and key in existing.keys


def _batch_totals(batch_id: str) -> dict[str, Any]:
    """ยอดรวมของทั้งรอบนำเข้าหลังจบงาน — ต่างจากยอดของการรันครั้งนี้เมื่อเป็นโหมดเติมไฟล์"""
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT award, match_status, COUNT(*) AS n
            FROM staging_pages WHERE batch_id = %s GROUP BY 1, 2
            """,
            (batch_id,),
        ).fetchall()

    by_award: dict[str, int] = {}
    total = 0
    for row in rows:
        total += row["n"]
        if row["match_status"] != "SKIPPED_FOREIGN" and row["award"]:
            by_award[row["award"]] = by_award.get(row["award"], 0) + row["n"]
    return {"pagesInBatch": total, "byAward": by_award}


def _resolve_award(bundle: Bundle, info: PageInfo, prefer_page_award: bool) -> Bundle:
    """รางวัลของหน้านี้

    ทางปกติ (อัป ZIP) รางวัลมาจากชื่อโฟลเดอร์เสมอ เพราะเป็นแหล่งเดียวที่ครบ
    แต่ตอนเติมไฟล์ทีละใบไม่มีโฟลเดอร์ให้อ้าง จึงเชื่อรางวัลที่พิมพ์บนหน้าก่อน
    แล้วค่อยถอยไปใช้รางวัลที่ระบบคาดไว้ (ซึ่งหน้า Perfect Score จะไม่มีให้อ่าน)
    """
    if not prefer_page_award or not info.award_on_page:
        return bundle
    from_page = normalize_award(info.award_on_page)
    if not from_page or from_page == bundle.award:
        return bundle
    return replace(bundle, award=from_page)


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
