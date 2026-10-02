"""กติกาเคลียร์ต้นฉบับเมื่อเผยแพร่เฉพาะรางวัลเสริม — ใช้ฐาน ocec_test และ S3 ปลอมเท่านั้น"""

import json
import pymupdf

from app.db import connection, new_id
from app.tasks.cleanup_sources import check_blockers, run_cleanup_sources
from app.tasks.finalize_webp import finalize_matched_assets


def _published_supplemental() -> tuple[str, str, str]:
    program_id, exam_id, batch_id = new_id(), new_id(), new_id()
    student_id, entry_id, page_id, cert_id = new_id(), new_id(), new_id(), new_id()
    with connection() as conn:
        conn.execute(
            "INSERT INTO exam_programs (id, code, name, updated_at) "
            "VALUES (%s, 'HKIMO', 'Synthetic', NOW())",
            (program_id,),
        )
        conn.execute(
            "INSERT INTO exams (id, program_id, round, year) VALUES (%s, %s, 'FINAL', 2099)",
            (exam_id, program_id),
        )
        conn.execute(
            "INSERT INTO batches (id, exam_id, status, profile_key, updated_at) "
            "VALUES (%s, %s, 'PUBLISHED', 'HKIMO_FINAL', NOW())",
            (batch_id, exam_id),
        )
        conn.execute(
            "INSERT INTO students (id, name_en, name_en_normalized) "
            "VALUES (%s, 'SOMCHAI JAIDEE', 'SOMCHAI JAIDEE')",
            (student_id,),
        )
        conn.execute(
            "INSERT INTO roster_entries "
            "(id, batch_id, candidate_no, exam_mode, source, student_id, updated_at) "
            "VALUES (%s, %s, '9001', 'ONLINE', 'EXCEL', %s, NOW())",
            (entry_id, batch_id, student_id),
        )
        conn.execute(
            "INSERT INTO staging_pages (id, batch_id, page_number, raw_text, award, "
            "match_status, roster_entry_id, matched_student_id) "
            "VALUES (%s, %s, 1, 'synthetic page', 'PERFECT_SCORE', 'MATCHED', %s, %s)",
            (page_id, batch_id, entry_id, student_id),
        )
        conn.execute(
            "INSERT INTO certificates "
            "(id, student_id, exam_id, batch_id, staging_page_id, roster_entry_id, "
            "pdf_key, preview_key, page_number, award, published_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, "
            "NULL, %s, 1, 'PERFECT_SCORE', NOW())",
            (cert_id, student_id, exam_id, batch_id, page_id, entry_id,
             f"previews/{batch_id}/final/seed/synthetic.webp"),
        )
    return batch_id, entry_id, cert_id


def _approve(entry_id: str, cert_id: str) -> None:
    with connection() as conn:
        preview_key = conn.execute(
            "SELECT preview_key FROM certificates WHERE id = %s", (cert_id,)
        ).fetchone()["preview_key"]
    snapshot = json.dumps(
        [[cert_id, "PERFECT_SCORE", preview_key]], separators=(",", ":")
    )
    with connection() as conn:
        conn.execute(
            "UPDATE roster_entries SET supplemental_only_snapshot = %s, "
            "supplemental_only_approved_at = NOW() WHERE id = %s",
            (snapshot, entry_id),
        )


def test_ยืนยันและเผยแพร่รางวัลเสริมแล้วเคลียร์ต้นฉบับได้(db):
    batch_id, entry_id, cert_id = _published_supplemental()
    assert any("ใบรางวัลเสริม" in reason for reason in check_blockers(batch_id))

    _approve(entry_id, cert_id)
    assert check_blockers(batch_id) == []

    zip_key = f"sources/{batch_id}/bundle-test.zip"
    roster_key = f"sources/{batch_id}/roster-test.xlsx"
    db.objects[zip_key] = b"synthetic zip"
    db.objects[roster_key] = b"synthetic roster"
    result = run_cleanup_sources(batch_id, lambda _: None)
    assert result["cleared"] is True
    assert zip_key not in db.objects
    assert roster_key in db.objects


def test_การยืนยันเก่าหรือใบที่ยังไม่เผยแพร่ยังกันการเคลียร์(db):
    batch_id, entry_id, cert_id = _published_supplemental()
    _approve(entry_id, cert_id)
    with connection() as conn:
        conn.execute(
            "UPDATE certificates SET preview_key = 'previews/replaced.webp' WHERE id = %s",
            (cert_id,),
        )
    assert any("ใบรางวัลเสริม" in reason for reason in check_blockers(batch_id))

    with connection() as conn:
        conn.execute(
            "UPDATE certificates SET preview_key = %s, published_at = NULL "
            "WHERE id = %s", (f"previews/{batch_id}/final/seed/synthetic.webp", cert_id)
        )
    assert any("ใบรางวัลเสริม" in reason for reason in check_blockers(batch_id))


def test_อนุมัติรางวัลเสริมไม่ข้ามคนตกหล่นหรือหน้าที่ยังไม่ตัดสิน(db):
    batch_id, entry_id, cert_id = _published_supplemental()
    _approve(entry_id, cert_id)
    with connection() as conn:
        conn.execute(
            "INSERT INTO roster_entries "
            "(id, batch_id, candidate_no, exam_mode, source, updated_at) "
            "VALUES (%s, %s, '9002', 'ONLINE', 'EXCEL', NOW())",
            (new_id(), batch_id),
        )
        conn.execute(
            "INSERT INTO staging_pages (id, batch_id, page_number, raw_text, match_status) "
            "VALUES (%s, %s, 2, 'synthetic unresolved page', 'UNMATCHED')",
            (new_id(), batch_id),
        )
    blockers = check_blockers(batch_id)
    assert any("ไม่มีเกียรติบัตร" in reason for reason in blockers)
    assert any("หน้าที่ต้องตัดสิน" in reason for reason in blockers)

    zip_key = f"sources/{batch_id}/bundle-test.zip"
    db.objects[zip_key] = b"synthetic zip"
    assert run_cleanup_sources(batch_id, lambda _: None)["cleared"] is False
    assert zip_key in db.objects


def test_ย้าย_pdf_รายใบแล้วลบเฉพาะหลังสลับรูปสำเร็จ(db):
    batch_id, entry_id, cert_id = _published_supplemental()
    pdf_key = f"certificates/{batch_id}/old.pdf"
    preview_key = f"previews/{batch_id}/old.webp"
    with pymupdf.open() as document:
        page = document.new_page(width=842, height=595)
        page.insert_text((72, 72), "Synthetic certificate")
        pdf_bytes = document.tobytes()
    db.objects[pdf_key] = pdf_bytes
    db.objects[preview_key] = b"old preview"
    with connection() as conn:
        conn.execute(
            "UPDATE certificates SET pdf_key = %s, preview_key = %s WHERE id = %s",
            (pdf_key, preview_key, cert_id),
        )
        conn.execute(
            "UPDATE staging_pages SET pdf_key = %s, preview_key = %s "
            "WHERE id = (SELECT staging_page_id FROM certificates WHERE id = %s)",
            (pdf_key, preview_key, cert_id),
        )
    _approve(entry_id, cert_id)
    with connection() as conn:
        conn.execute(
            "UPDATE roster_entries SET supplemental_only_snapshot = %s WHERE id = %s",
            (json.dumps([[cert_id, "PERFECT_SCORE", pdf_key]]), entry_id),
        )

    result = finalize_matched_assets(batch_id, new_id(), lambda _: None)
    assert result["converted"] == 1
    assert result["failed"] == 0
    assert pdf_key not in db.objects
    assert preview_key not in db.objects
    with connection() as conn:
        cert = conn.execute(
            "SELECT pdf_key, preview_key FROM certificates WHERE id = %s", (cert_id,)
        ).fetchone()
        page = conn.execute(
            "SELECT pdf_key, preview_key FROM staging_pages "
            "WHERE id = (SELECT staging_page_id FROM certificates WHERE id = %s)", (cert_id,)
        ).fetchone()
        snapshot = conn.execute(
            "SELECT supplemental_only_snapshot FROM roster_entries WHERE id = %s", (entry_id,)
        ).fetchone()["supplemental_only_snapshot"]
    assert cert["pdf_key"] is None and page["pdf_key"] is None
    assert cert["preview_key"] == page["preview_key"]
    assert cert["preview_key"] in db.objects
    assert json.loads(snapshot)[0][2] == cert["preview_key"]
    assert finalize_matched_assets(batch_id, new_id(), lambda _: None)["converted"] == 0
