"""แตก ZIP แล้วตัดแยก PDF รวมเล่มเป็นไฟล์รายบุคคล + สร้างรูป preview แล้วจับคู่ต่อทันที

รายชื่อต้องมาก่อนเสมอ อัป ZIP ได้หลายครั้ง แต่ละครั้ง **เติม** เฉพาะสิ่งที่ยังไม่มี:
  - หน้าเดิมเป๊ะ (เนื้อหา + โฟลเดอร์ online/onsite + รางวัล เหมือนเดิม) -> จำได้ ข้าม ไม่เกิดรายการซ้ำ
  - (เลขผู้เข้าสอบ, รางวัล) ที่ออกใบไปแล้ว -> ข้าม ไม่แตะใบเดิม
  - หน้าใหม่ของ (เลข, รางวัล) ที่ยังติดปัญหาจากการอัปครั้งก่อน -> หน้าใหม่มาแทน หน้าเดิมเก็บเป็นหลักฐาน
    (เช่นอัปใหม่หลังย้ายไฟล์ไปโฟลเดอร์ online/onsite ที่ถูก — ใบที่เคยติดปัญหาจะถูกปิดไปเอง)
  หน้าที่ติดปัญหาไม่ทำให้หน้าที่ถูกต้องซึ่งมาทีหลังถูกข้าม

การกรองสัญชาติเป็นของโปรไฟล์: รอบ Heat รับทุกหน้า (ค่าหลัง from คือโรงเรียน)
รอบ Final รับเฉพาะ THAILAND ประเทศอื่นข้าม และหน้าที่ไม่มีหลักฐานส่งให้แอดมินดู

ไฟล์ที่สร้างเก็บใต้ prefix ของงาน (certificates/<batch>/<job>/) งานที่พังจึงย้อนได้ทั้งก้อน
ต้นฉบับ ZIP ยังเก็บไว้ให้ตรวจย้อนหลังจนกว่าจะถึงรอบเคลียร์ไฟล์ต้นฉบับตามปกติ

อัป PDF ให้ผู้เข้าสอบคนเดียว (payload.kind == "single") ใช้ทางเดินเดียวกัน
แต่รางวัลมาจากที่แอดมินเลือกเอง และต้องผ่านการตรวจเลข + ชื่อก่อนเสมอ
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass, field, replace
from typing import Any, Callable

import pymupdf

from ..audit import record_audit
from ..certificate_profiles import CertificateProfile, Nationality, ParsedCertificate, get_profile
from ..config import settings
from ..db import connection, new_id
from ..normalize import name_sort_key, normalize_name
from ..storage import (
    certificate_pdf_key,
    certificate_stem,
    delete_keys,
    download_to_file,
    job_output_prefixes,
    list_keys,
    preview_key,
    unique_stem,
    upload_bytes,
)
from .extract import page_fingerprint, page_text
from .match import run_match
from .render_preview import render_webp
from .zip_bundle import Bundle, ZipLayoutError, open_bundles, preflight_zip

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

# หน้าที่ยังไม่มีข้อสรุป — ถ้ามีหน้าใหม่ของ (เลข, รางวัล) เดียวกันเข้ามา หน้าเหล่านี้ถูกแทน
UNRESOLVED = (
    "UNMATCHED", "NAME_MISMATCH", "MODE_MISMATCH", "AMBIGUOUS", "DUPLICATE_NAME",
    "NATIONALITY_UNVERIFIED", "PARSE_REVIEW",
)

# จำนวนหน้าที่ยกตัวอย่างในข้อความผิดพลาด — ไฟล์รวมเล่มมีหลายร้อยหน้า ไล่ทั้งหมดอ่านไม่รู้เรื่อง
MAX_LISTED_PAGES = 5


def run_split(
    batch_id: str, job_id: str, on_progress: ProgressFn, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    payload = payload or {}
    batch = _load_batch(batch_id)
    profile = get_profile(batch["program_code"], batch["round"])
    if batch["profile_key"] and batch["profile_key"] != profile.key:
        raise ValueError(f"รอบนำเข้านี้ตั้งไว้กับโปรไฟล์ {batch['profile_key']} ไม่ใช่ {profile.key}")
    if not batch["active_roster_import_id"]:
        raise ValueError("ต้องมีรายชื่อผู้เข้าสอบที่ใช้งานอยู่ก่อน จึงจะนำเข้าเกียรติบัตรได้")

    # รันซ้ำ (worker ตายกลางทาง) ต้องเริ่มจากศูนย์ ไม่ใช่ต่อจากของครึ่ง ๆ กลาง ๆ
    rollback_job_outputs(batch_id, job_id)

    progress = _Progress(on_progress)
    with tempfile.TemporaryDirectory() as workdir:
        if payload.get("kind") == "single":
            stats = _run_single(batch, profile, job_id, payload, workdir, progress)
        else:
            stats = _run_zip(batch, profile, job_id, payload, workdir, progress)

    stats["match"] = run_match(batch_id, progress.update)
    log.info("นำเข้า batch %s งาน %s เสร็จ: %s", batch_id, job_id, stats)
    return stats


class _Progress:
    """รายงานความคืบหน้า โดยคงผลตรวจ ZIP ไว้ทุกครั้ง — หน้าจอต้องเห็นว่าตรวจอะไรไปแล้ว"""

    def __init__(self, sink: ProgressFn) -> None:
        self.sink = sink
        self.context: dict[str, Any] = {}

    def update(self, values: dict[str, Any]) -> None:
        self.sink({**self.context, **values})


# ---------------------------------------------------------------- ZIP


def _run_zip(
    batch: dict[str, Any], profile: CertificateProfile, job_id: str, payload: dict[str, Any],
    workdir: str, progress: _Progress,
) -> dict[str, Any]:
    zip_key = payload.get("zipKey")
    if not zip_key:
        raise ValueError("งานนี้ไม่มีไฟล์ ZIP ต้นทาง")

    # ดาวน์โหลดลงดิสก์ ไม่ใช่หน่วยความจำ — ZIP จริงขนาดหลายร้อย MB
    zip_path = os.path.join(workdir, "bundle.zip")
    download_to_file(zip_key, zip_path)
    try:
        report = preflight_zip(zip_path, profile, batch["year"])
    except ZipLayoutError as exc:
        progress.context = {"preflight": exc.report}
        progress.update({"stage": "preflight"})
        raise
    progress.context = {"preflight": report.to_dict()}
    progress.update({"stage": "preflight"})
    log.info("ตรวจ ZIP ผ่าน: %s ไฟล์ %s หน้า", len(report.bundles), sum(b.pages for b in report.bundles))

    existing = ExistingState.load(batch["id"])
    roster_modes = _load_roster_modes(batch["id"]) if report.layout == "AWARD_ONLY" else None
    stats = _new_stats("zip", payload)
    total = sum(b.pages for b in report.bundles)

    with open_bundles(zip_path, report.bundles) as stream:
        for bundle in stream:
            with pymupdf.open(stream=bundle.data, filetype="pdf") as doc:
                for index in range(doc.page_count):
                    _process_page(batch, profile, job_id, doc, index, bundle, existing, stats, "ZIP",
                                  roster_modes=roster_modes)
                    read = stats["pagesRead"]
                    if read % 10 == 0 or read == total:
                        progress.update({"stage": "split", "done": read, "total": total})

    stats["superseded"] = _supersede(batch["id"], job_id)
    stats["preflight"] = report.to_dict()
    return stats


def _new_stats(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": kind,
        "fileName": payload.get("fileName"),
        "pagesRead": 0,
        "newPages": 0,
        "pagesSplit": 0,
        "skippedAccepted": 0,
        "recognized": 0,
        "foreignSkipped": 0,
        "nationalityUnverified": 0,
        "parseReview": 0,
        "superseded": 0,
        "nameNotFound": 0,
        "certNoNotFound": 0,
        "awardTextMismatch": 0,
        "byAward": {},
        "byMode": {},
    }


def _process_page(
    batch: dict[str, Any],
    profile: CertificateProfile,
    job_id: str,
    doc: Any,
    index: int,
    bundle: Bundle,
    existing: "ExistingState",
    stats: dict[str, Any],
    source_kind: str,
    confirm_nationality: bool = False,
    roster_modes: dict[str, str] | None = None,
) -> str | None:
    """ประมวลผลหน้า 1 หน้า — คืน id ของหน้าที่บันทึกใหม่ หรือ None ถ้าข้าม"""
    stats["pagesRead"] += 1
    page = doc[index]
    text = page_text(page)
    parsed = profile.parse(text, batch["year"])
    extra = dict(parsed.extra)
    if roster_modes is not None:
        # Award-only ZIP has no independent mode folder. Keep the provenance so rematch can
        # rederive the mode after a roster replacement instead of trusting a stale snapshot.
        extra["modeSource"] = "ROSTER"
        modes_on_page = _printed_modes(text)
        if len(modes_on_page) == 1:
            extra["printedMode"] = next(iter(modes_on_page))
        elif len(modes_on_page) > 1:
            parsed = replace(parsed, errors=(*parsed.errors, "พบทั้ง ONLINE และ ONSITE บนหน้าเดียวกัน"))
        bundle = replace(bundle, mode=roster_modes.get(parsed.candidate_no or ""))
    fingerprint = page_fingerprint(page, text)

    if (fingerprint, bundle.mode, bundle.award) in existing.recognized:
        # หน้าเดิมเป๊ะที่เคยอัปมาแล้ว (จะรับไปแล้ว ติดปัญหา หรือถูกทิ้งก็ตาม) — ไม่สร้างรายการซ้ำ
        stats["recognized"] += 1
        return None
    if parsed.candidate_no and (parsed.candidate_no, bundle.award) in existing.accepted:
        stats["skippedAccepted"] += 1
        return None
    existing.recognized.add((fingerprint, bundle.mode, bundle.award))

    status, warnings, confirmed = _initial_status(profile, parsed, confirm_nationality)
    if bundle.level_folder:
        extra["folderLevel"] = bundle.level_folder

    pdf_key = prev_key = None
    if status == "SKIPPED_FOREIGN":
        # หน้าของต่างชาติไม่ต้องมีไฟล์ — ไม่มีวันถูกเผยแพร่ เก็บแถวไว้นับยอดเท่านั้น
        stats["foreignSkipped"] += 1
    else:
        stem = unique_stem(
            certificate_stem(
                normalize_name(parsed.name or ""), batch["program_code"], batch["round"],
                bundle.award, parsed.year_on_page or batch["year"], existing.max_page + 1,
            ),
            existing.stems,
        )
        cfg = settings()
        pdf_key = certificate_pdf_key(batch["id"], stem, job_id)
        prev_key = preview_key(batch["id"], stem, job_id)
        upload_bytes(pdf_key, _single_page_pdf(doc, index), "application/pdf")
        upload_bytes(prev_key, render_webp(page, cfg.preview_dpi, cfg.preview_quality), "image/webp")
        stats["pagesSplit"] += 1
        stats["byAward"][bundle.award] = stats["byAward"].get(bundle.award, 0) + 1
        if bundle.mode:
            stats["byMode"][bundle.mode] = stats["byMode"].get(bundle.mode, 0) + 1
        if status == "NATIONALITY_UNVERIFIED":
            stats["nationalityUnverified"] += 1
        elif status == "PARSE_REVIEW":
            stats["parseReview"] += 1

    if not parsed.name:
        stats["nameNotFound"] += 1
    if not parsed.candidate_no:
        stats["certNoNotFound"] += 1
    award_text = profile.catalog.resolve_text(parsed.award_text) if parsed.award_text else None
    if parsed.award_text and (award_text is None or award_text.code != bundle.award):
        stats["awardTextMismatch"] += 1
        warnings.append(
            f"ข้อความรางวัลบนหน้า ({parsed.award_text}) ไม่ตรงกับโฟลเดอร์ ({bundle.award_label})"
        )

    existing.max_page += 1
    page_id = new_id()
    _insert_page(
        batch["id"], page_id, existing.max_page, text, parsed, bundle, pdf_key, prev_key, status,
        job_id, source_kind, fingerprint, warnings, extra, confirmed,
    )
    stats["newPages"] += 1
    return page_id


_MODE_LINE = re.compile(r"(?i)^(?:(?:EXAM\s*MODE|MODE)\s*[:：]?\s*)?(ONLINE|ONSITE)$")


def _printed_modes(text: str) -> set[str]:
    """Only accept an explicit mode line; a word inside a school name is not evidence."""
    return {match.group(1).upper() for line in text.splitlines()
            if (match := _MODE_LINE.fullmatch(line.strip()))}


def _load_roster_modes(batch_id: str) -> dict[str, str]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT candidate_no, exam_mode::text AS exam_mode FROM roster_entries WHERE batch_id = %s",
            (batch_id,),
        ).fetchall()
    return {row["candidate_no"]: row["exam_mode"] for row in rows}


def _initial_status(
    profile: CertificateProfile, parsed: ParsedCertificate, confirm_nationality: bool
) -> tuple[str, list[str], bool]:
    """สถานะตั้งต้นจากการอ่านหน้า — ตรวจรอบ/ปีก่อนสัญชาติ

    ไฟล์ผิดชุด (เช่นใบรอบ Heat ในรอบนำเข้า Final) ค่าหลัง from จะเป็นชื่อโรงเรียน
    ถ้าตรวจสัญชาติก่อน ทุกหน้าจะกลายเป็น "ต่างชาติ" แล้วถูกข้ามเงียบ ๆ

    คืน (สถานะ, ข้อสังเกต, แอดมินยืนยันสัญชาติแทนหรือไม่)
    """
    warnings = list(parsed.warnings)
    if parsed.errors:
        return "PARSE_REVIEW", warnings, False
    nationality = profile.nationality(parsed)
    if nationality is Nationality.FOREIGN:
        return "SKIPPED_FOREIGN", warnings, False
    if nationality is Nationality.UNVERIFIED:
        if confirm_nationality:
            # แอดมินเลือกไฟล์นี้ให้ผู้เข้าสอบในรายชื่อคนนี้เอง — การเลือกนั้นคือการยืนยัน
            warnings.append("หน้านี้ไม่มีหลักฐานสัญชาติ แต่แอดมินอัปให้ผู้เข้าสอบคนนี้โดยตรง")
            return "UNMATCHED", warnings, True
        return "NATIONALITY_UNVERIFIED", warnings, False
    return "UNMATCHED", warnings, False


@dataclass
class ExistingState:
    """สิ่งที่มีอยู่แล้วในรอบนำเข้านี้ ใช้ตัดสินว่าหน้าที่อัปเข้ามาใหม่ต้องเติมหรือข้าม"""

    max_page: int = 0
    stems: set[str] = field(default_factory=set)
    # (ลายนิ้วมือหน้า, online/onsite, รางวัลตามโฟลเดอร์) ของทุกหน้าที่เคยอัป
    recognized: set[tuple[str, str | None, str]] = field(default_factory=set)
    # (เลขผู้เข้าสอบ, รางวัล) ที่ออกใบไปแล้ว — นับทั้งรางวัลตามโฟลเดอร์และรางวัลที่แอดมินเปลี่ยน
    accepted: set[tuple[str, str]] = field(default_factory=set)

    @classmethod
    def load(cls, batch_id: str) -> "ExistingState":
        with connection() as conn:
            rows = conn.execute(
                """
                SELECT sp.page_number, sp.pdf_key, sp.fingerprint, sp.exam_mode::text AS exam_mode,
                       sp.award, sp.award_override, sp.cert_no, re.candidate_no AS entry_no,
                       (c.id IS NOT NULL) AS accepted
                FROM staging_pages sp
                LEFT JOIN roster_entries re ON re.id = sp.roster_entry_id
                LEFT JOIN certificates c ON c.staging_page_id = sp.id
                WHERE sp.batch_id = %s
                """,
                (batch_id,),
            ).fetchall()

        state = cls(max_page=max((r["page_number"] for r in rows), default=0))
        for row in rows:
            if row["pdf_key"]:
                state.stems.add(row["pdf_key"].rsplit("/", 1)[-1].removesuffix(".pdf"))
            if row["fingerprint"] and row["award"]:
                state.recognized.add((row["fingerprint"], row["exam_mode"], row["award"]))
            if row["accepted"]:
                numbers = {row["entry_no"], row["cert_no"]} - {None}
                awards = {row["award"], row["award_override"]} - {None}
                state.accepted.update((n, a) for n in numbers for a in awards)
        return state


def _supersede(batch_id: str, job_id: str) -> int:
    """หน้าเก่าที่ยังติดปัญหา ถูกแทนด้วยหน้าใหม่ของ (เลข, รางวัล) เดียวกันจากงานนี้

    ทำเป็นขั้นสุดท้ายหลังตัดหน้าครบแล้ว — ถ้างานพังกลางทาง หน้าเก่ายังอยู่ครบไม่ถูกแตะ
    เก็บสถานะเดิมไว้ใน review เผื่อต้องย้อนงานนี้ จะได้คืนกลับได้ถูก
    """
    with connection() as conn:
        rows = conn.execute(
            """
            UPDATE staging_pages AS old
            SET match_status = 'SUPERSEDED',
                superseded_by_id = new.id,
                review = old.review || jsonb_build_object('supersededFrom', old.match_status::text),
                match_note = 'มีไฟล์ใหม่กว่ามาแทนแล้ว (หน้า ' || new.page_number || ')'
            FROM staging_pages AS new
            WHERE new.batch_id = %s AND new.source_job_id = %s
              AND old.batch_id = new.batch_id
              AND old.source_job_id IS DISTINCT FROM new.source_job_id
              AND old.cert_no = new.cert_no AND old.award = new.award
              AND new.match_status <> 'SKIPPED_FOREIGN'
              AND old.match_status::text = ANY(%s)
            RETURNING old.id
            """,
            (batch_id, job_id, list(UNRESOLVED)),
        ).fetchall()
    return len(rows)


def rollback_job_outputs(batch_id: str, job_id: str) -> int:
    """ย้อนทุกอย่างที่งานนี้สร้าง: คืนหน้าที่ถูกแทน ลบหน้าที่สร้าง และลบไฟล์ใต้ prefix ของงาน

    ต้นฉบับ (ZIP/PDF ที่อัปมา) ไม่ถูกลบ — เก็บไว้ให้ตรวจสอบว่าทำไมพัง
    """
    with connection() as conn, conn.transaction():
        conn.execute(
            """
            UPDATE staging_pages AS old
            SET match_status = (old.review->>'supersededFrom')::"MatchStatus",
                superseded_by_id = NULL,
                review = old.review - 'supersededFrom',
                match_note = NULL
            FROM staging_pages AS new
            WHERE new.source_job_id = %s AND old.superseded_by_id = new.id
              AND old.review ? 'supersededFrom'
            """,
            (job_id,),
        )
        removed = conn.execute(
            "DELETE FROM staging_pages WHERE batch_id = %s AND source_job_id = %s RETURNING id",
            (batch_id, job_id),
        ).fetchall()

    keys = [f["key"] for prefix in job_output_prefixes(batch_id, job_id) for f in list_keys(prefix)]
    delete_keys(keys)
    if removed or keys:
        log.warning("ย้อนงาน %s: ลบหน้า %s หน้า ไฟล์ %s ชิ้น", job_id, len(removed), len(keys))
    return len(removed)


# ---------------------------------------------------------------- PDF ให้ผู้เข้าสอบคนเดียว


def _run_single(
    batch: dict[str, Any], profile: CertificateProfile, job_id: str, payload: dict[str, Any],
    workdir: str, progress: _Progress,
) -> dict[str, Any]:
    """แอดมินอัป PDF ให้ผู้เข้าสอบคนหนึ่งโดยตรง — เพิ่มใบที่ขาด หรือเปลี่ยนไฟล์ของใบเดิม

    ตรวจ **ก่อน** ลงมือประมวลผลว่าไฟล์มีหน้าของคนนี้จริง (เลขและชื่อต้องตรง)
    ถ้าหยิบไฟล์ผิดคนแล้วปล่อยผ่าน เกียรติบัตรจะไปโผล่ในชื่อผิดคนบนหน้าเว็บ

    ไฟล์ที่ต้นทางส่งมามักเป็นเล่มรวมหลายหน้า จึงคัดเฉพาะหน้าของคนนี้ออกมาหน้าเดียว
    """
    entry = _load_entry(batch["id"], payload.get("rosterEntryId"))
    award = profile.catalog.get(payload.get("awardCode"))
    if award is None:
        raise ValueError(f"รางวัล {payload.get('awardCode')} ไม่มีในรายการสอบ/รอบนี้")
    purpose = payload.get("purpose") or "add"
    replacing = _load_replace_target(batch["id"], entry, award.code, payload) if purpose == "replace" else None
    if purpose == "add" and _has_certificate(entry["id"], award.code):
        raise ValueError(
            f"เลข {entry['candidate_no']} มีเกียรติบัตรรางวัล {award.label} อยู่แล้ว "
            "— ถ้าต้องการเปลี่ยนไฟล์ ให้ใช้ปุ่มเปลี่ยนไฟล์ที่ใบนั้น"
        )

    pdf_path = os.path.join(workdir, "single.pdf")
    download_to_file(payload["pdfKey"], pdf_path)

    stats = _new_stats("single", payload)
    existing = ExistingState.load(batch["id"])
    with pymupdf.open(pdf_path) as doc:
        index, note = pick_own_page(doc, profile, batch["year"], entry, award)
        bundle = Bundle(
            mode=entry["exam_mode"], award=award.code, award_label=award.label,
            source_file=payload.get("fileName") or os.path.basename(payload["pdfKey"]),
        )
        fingerprint = page_fingerprint(doc[index], page_text(doc[index]))
        if replacing and replacing["fingerprint"] == fingerprint:
            raise ValueError("ไฟล์นี้เนื้อหาเหมือนใบเดิมทุกอย่าง ไม่มีอะไรให้เปลี่ยน")
        # ไฟล์ที่แอดมินเลือกให้คนนี้โดยตรง ต้องประมวลผลเสมอ แม้เคยอัปหน้าเดียวกันไว้
        existing.recognized.discard((fingerprint, bundle.mode, bundle.award))
        existing.accepted = {k for k in existing.accepted if k != (entry["candidate_no"], award.code)}
        page_id = _process_page(
            batch, profile, job_id, doc, index, bundle, existing, stats, "SINGLE_PDF",
            confirm_nationality=True,
        )
    if page_id is None:
        raise ValueError("ไม่ได้นำเข้าหน้านี้ — กรุณาลองอัปใหม่อีกครั้ง")

    with connection() as conn, conn.transaction():
        if replacing:
            conn.execute(
                """
                UPDATE staging_pages
                SET match_status = 'SUPERSEDED', superseded_by_id = %s,
                    review = review || jsonb_build_object('supersededFrom', match_status::text),
                    match_note = 'แอดมินเปลี่ยนไฟล์ใหม่แทนแล้ว'
                WHERE id = %s
                """,
                (page_id, replacing["id"]),
            )
        record_audit(
            conn, batch_id=batch["id"], batch_label=batch["label"], entity_type="ROSTER_ENTRY",
            entity_id=entry["id"],
            action="CERTIFICATE_FILE_REPLACED" if replacing else "CERTIFICATE_ADDED",
            session_id=payload.get("sessionId") or "system",
            before=(
                {"stagingPageId": replacing["id"], "award": award.code, "pdfKey": replacing["pdf_key"]}
                if replacing else None
            ),
            after={
                "stagingPageId": page_id, "award": award.code, "candidateNo": entry["candidate_no"],
                "fileName": bundle.source_file, **note,
            },
        )

    # หน้าเก่าของ (เลข, รางวัล) เดียวกันที่ยังติดปัญหาอยู่ (เช่นอยู่ผิดโฟลเดอร์ online/onsite)
    # ถูกปิดไปด้วย ไม่งั้นผู้เข้าสอบคนนี้จะยังถูกกันไม่ให้เผยแพร่ทั้งที่ได้ไฟล์ที่ถูกแล้ว
    stats["singlePdf"] = note
    stats["superseded"] = _supersede(batch["id"], job_id) + (1 if replacing else 0)
    progress.update({"stage": "split", "done": 1, "total": 1})
    return stats


def pick_own_page(
    doc: Any, profile: CertificateProfile, batch_year: int, entry: dict[str, Any], award: Any
) -> tuple[int, dict[str, Any]]:
    """หาหน้าของผู้เข้าสอบคนนี้ในไฟล์ที่อัปมา — คืน (ลำดับหน้า, หมายเหตุสำหรับแอดมิน)

    เทียบด้วย **เลขบนหน้ากระดาษ** ก่อน แล้วยืนยันด้วยชื่อ — ชื่ออย่างเดียวไม่พอ คนชื่อพ้องกันมีจริง
    เลขเดียวกันหลายหน้า (คนเดียวได้หลายใบ) คัดด้วยข้อความรางวัลบนหน้า
    ถ้ายังชี้ชัดไม่ได้ **ไม่เดา** ให้แยกไฟล์มาเป็นหน้าเดียว
    """
    pages = [(i, profile.parse(page_text(doc[i]), batch_year)) for i in range(doc.page_count)]
    mine = [(i, p) for i, p in pages if p.candidate_no == entry["candidate_no"]]
    names = {n for n in (normalize_name(entry["name_en"] or ""), normalize_name(entry["name_th"] or "")) if n}

    if not mine:
        raise _wrong_person_error(pages, entry["candidate_no"], names)
    if len(mine) > 1:
        mine = _narrow_by_award(mine, profile, award) or mine
    if len(mine) > 1:
        texts = ", ".join(p.award_text or "ไม่มีข้อความรางวัล" for _, p in mine)
        raise ValueError(
            f"ไฟล์นี้มีหน้าของเลข {entry['candidate_no']} อยู่ {len(mine)} หน้า ({texts}) "
            "ระบบแยกไม่ออกว่าหน้าไหนคือใบที่ต้องการ "
            "กรุณาแยกใบนั้นออกมาเป็นไฟล์ PDF หน้าเดียวแล้วอัปอีกครั้ง"
        )

    index, parsed = mine[0]
    if normalize_name(parsed.name or "") not in names:
        shown = parsed.name or "อ่านชื่อไม่ได้"
        raise ValueError(
            f"เลขบนหน้าตรงกับ {entry['candidate_no']} แต่ชื่อบนเกียรติบัตร ({shown}) "
            "ไม่ตรงกับชื่อในรายชื่อ — ตรวจว่าหยิบไฟล์ถูกคน หรือแก้ชื่อในรายชื่อก่อน"
        )
    if parsed.errors:
        raise ValueError("; ".join(parsed.errors))
    if profile.nationality(parsed) is Nationality.FOREIGN:
        raise ValueError(
            f"หน้านี้เป็นของผู้เข้าสอบจาก {parsed.country_on_page} ระบบนำเข้าเฉพาะผู้เข้าสอบไทย"
        )

    total = len(pages)
    note: dict[str, Any] = {"sourcePages": total, "usedPage": index + 1}
    if total > 1:
        note["note"] = (
            f"ไฟล์ที่อัปมามี {total} หน้า ระบบใช้เฉพาะหน้าที่ {index + 1} "
            f"ซึ่งเป็นของเลข {entry['candidate_no']} — หน้าอื่นไม่ถูกนำเข้า"
        )
    return index, note


def _narrow_by_award(
    candidates: list[tuple[int, ParsedCertificate]], profile: CertificateProfile, award: Any
) -> list[tuple[int, ParsedCertificate]]:
    """คัดด้วยข้อความรางวัลบนหน้า — ใช้เลือกหน้าเท่านั้น รางวัลของใบมาจากที่แอดมินเลือก

    หน้า Perfect Score ของจริงไม่มีข้อความรางวัล จึงคัดด้วยการ "ไม่มีข้อความ" แทน
    คืนลิสต์ว่างเมื่อชี้ชัดไม่ได้ ให้ผู้เรียกไปบอกแอดมินแยกไฟล์มา ดีกว่าเดา
    """
    matched = [
        c for c in candidates
        if c[1].award_text and (found := profile.catalog.resolve_text(c[1].award_text)) and found.code == award.code
    ]
    if not matched and award.code == "PERFECT_SCORE":
        matched = [c for c in candidates if not c[1].award_text]
    return matched if len(matched) == 1 else []


def _wrong_person_error(
    pages: list[tuple[int, ParsedCertificate]], candidate_no: str, names: set[str]
) -> ValueError:
    """ข้อความเมื่อไฟล์ไม่มีหน้าของคนที่ควรจะเป็น

    กรณีที่เจอบ่อย: แอดมินแก้ไฟล์เองโดยเปลี่ยนแค่ชื่อ ลืมแก้เลข
    ข้อความจึงต้องบอกให้ชัดว่าต้องแก้อะไร ไม่ใช่แค่บอกว่า "ไม่ตรง"
    """
    name_matched = [
        p.candidate_no or "อ่านเลขไม่ได้" for _, p in pages if normalize_name(p.name or "") in names
    ]
    if name_matched:
        return ValueError(
            f"ชื่อบนเกียรติบัตรตรงกับผู้เข้าสอบคนนี้แล้ว แต่เลขบนหน้าเป็น {name_matched[0]} "
            f"ซึ่งเป็นของคนอื่น ต้องเป็น {candidate_no} — ถ้าแก้ไฟล์เอง อย่าลืมแก้บรรทัด Cert No ด้วย"
        )
    listed = [f"{p.candidate_no or 'อ่านเลขไม่ได้'} ({p.name or 'อ่านชื่อไม่ได้'})" for _, p in pages[:MAX_LISTED_PAGES]]
    summary = ", ".join(listed) or "(ไม่มีหน้าเลย)"
    if len(pages) > len(listed):
        summary += f" และอีก {len(pages) - len(listed)} หน้า"
    return ValueError(
        f"ไฟล์นี้ไม่มีหน้าของผู้เข้าสอบเลข {candidate_no} — ในไฟล์พบ: {summary} "
        "กรุณาตรวจว่าหยิบไฟล์ถูกคนหรือไม่"
    )


def _load_entry(batch_id: str, entry_id: str | None) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT id::text, candidate_no, name_en, name_th, exam_mode::text AS exam_mode
            FROM roster_entries WHERE id = %s AND batch_id = %s
            """,
            (entry_id, batch_id),
        ).fetchone()
    if row is None:
        raise ValueError("ไม่พบผู้เข้าสอบคนนี้ในรายชื่อที่ใช้อยู่ — อาจถูกลบไปแล้ว")
    return row


def _load_replace_target(
    batch_id: str, entry: dict[str, Any], award_code: str, payload: dict[str, Any]
) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT sp.id::text, sp.fingerprint, sp.pdf_key
            FROM staging_pages sp JOIN certificates c ON c.staging_page_id = sp.id
            WHERE sp.id = %s AND sp.batch_id = %s AND sp.roster_entry_id = %s
              AND COALESCE(sp.award_override, sp.award) = %s
            """,
            (payload.get("replacePageId"), batch_id, entry["id"], award_code),
        ).fetchone()
    if row is None:
        raise ValueError("ไม่พบเกียรติบัตรใบเดิมที่จะเปลี่ยนไฟล์ — อาจถูกเปลี่ยนหรือทิ้งไปแล้ว")
    return row


def _has_certificate(entry_id: str, award_code: str) -> bool:
    with connection() as conn:
        return conn.execute(
            "SELECT 1 FROM certificates WHERE roster_entry_id = %s AND award = %s",
            (entry_id, award_code),
        ).fetchone() is not None


# ---------------------------------------------------------------- ฐานข้อมูลและไฟล์


def _single_page_pdf(doc: Any, index: int) -> bytes:
    """คัดหน้าเดียวออกมาเป็นไฟล์ใหม่ โดยคงคุณภาพต้นฉบับไว้ครบ (ไม่ได้แปลงเป็นภาพ)"""
    with pymupdf.open() as out:
        out.insert_pdf(doc, from_page=index, to_page=index)
        return out.tobytes(garbage=3, deflate=True)


def _load_batch(batch_id: str) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT b.id::text, b.profile_key, b.active_roster_import_id, p.code AS program_code,
                   e.round::text AS round, e.year
            FROM batches b
            JOIN exams e ON e.id = b.exam_id
            JOIN exam_programs p ON p.id = e.program_id
            WHERE b.id = %s
            """,
            (batch_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"ไม่พบ batch {batch_id}")
    return {**row, "label": f"{row['program_code']} {row['round']} {row['year']}"}


def _insert_page(
    batch_id: str,
    page_id: str,
    page_number: int,
    raw_text: str,
    parsed: ParsedCertificate,
    bundle: Bundle,
    pdf_key: str | None,
    prev_key: str | None,
    status: str,
    job_id: str,
    source_kind: str,
    fingerprint: str,
    warnings: list[str],
    extra: dict[str, str],
    nationality_confirmed: bool,
) -> None:
    normalized = normalize_name(parsed.name or "") or None
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO staging_pages
              (id, batch_id, page_number, raw_text, extracted_name, extracted_name_normalized,
               extracted_name_sort_key, cert_no, level, award, award_label, award_on_page,
               cert_year, round_on_page, source_file, pdf_key, preview_key, match_status,
               exam_mode, source_job_id, source_kind, school_on_page, country_on_page,
               warnings, parse_errors, extra, fingerprint, nationality_confirmed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, CASE WHEN %s THEN NOW() END)
            """,
            (
                page_id, batch_id, page_number, raw_text, parsed.name, normalized,
                name_sort_key(parsed.name or "") or None, parsed.candidate_no, parsed.level,
                bundle.award, bundle.award_label, parsed.award_text, parsed.year_on_page,
                parsed.round_on_page, bundle.source_file, pdf_key, prev_key, status,
                bundle.mode, job_id, source_kind, parsed.school_on_page, parsed.country_on_page,
                json.dumps(warnings, ensure_ascii=False), json.dumps(list(parsed.errors), ensure_ascii=False),
                json.dumps(extra, ensure_ascii=False), fingerprint, nationality_confirmed,
            ),
        )
