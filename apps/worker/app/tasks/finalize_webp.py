"""ทำ WebP คุณภาพปัจจุบันให้ใบที่จับคู่แล้ว และลบไฟล์เดิมหลังสลับคีย์สำเร็จ

อ่านจาก split PDF เมื่อยังมี หรือบีบอัด WebP รุ่นเก่าซ้ำเมื่อ PDF ถูกลบแล้ว
ไฟล์ต้นฉบับใน sources/ และหน้าที่ยังจับคู่ไม่ได้ไม่ถูกแตะที่นี่
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import tempfile
from typing import Any, Callable

import pymupdf
from PIL import Image

from ..config import settings
from ..db import connection, new_id
from ..storage import (
    current_webp_pattern,
    delete_keys,
    download_bytes,
    download_to_file,
    final_webp_key,
    head_object,
    is_current_webp_key,
    upload_bytes,
)
from .render_preview import render_webp, validate_webp

log = logging.getLogger(__name__)
ProgressFn = Callable[[dict[str, Any]], None]


class StaleAsset(ValueError):
    """แถวเปลี่ยนระหว่างอ่าน PDF กับสลับคีย์ — ห้ามเขียนทับผลใหม่"""


def _pending_pages(batch_id: str) -> list[dict[str, Any]]:
    with connection() as conn:
        return conn.execute(
            """
            SELECT c.id::text AS certificate_id, c.roster_entry_id::text,
                   c.pdf_key AS certificate_pdf_key, c.preview_key, sp.id::text AS page_id,
                   COALESCE(NULLIF(c.pdf_key, ''), NULLIF(sp.pdf_key, '')) AS source_pdf_key,
                   sp.pdf_key AS staging_pdf_key, sp.preview_key AS staging_preview_key
            FROM certificates c
            JOIN staging_pages sp ON sp.id = c.staging_page_id
            WHERE c.batch_id = %s AND c.files_deleted_at IS NULL
              AND sp.match_status = 'MATCHED'
              AND (
                NULLIF(c.pdf_key, '') IS NOT NULL
                OR NULLIF(sp.pdf_key, '') IS NOT NULL
                OR c.preview_key IS NULL
                OR c.preview_key NOT LIKE %s
                OR sp.preview_key IS DISTINCT FROM c.preview_key
              )
            ORDER BY sp.page_number
            """,
            (batch_id, current_webp_pattern(
                batch_id, settings().cert_image_dpi, settings().cert_image_quality
            )),
        ).fetchall()


def _unresolved_count(batch_id: str) -> int:
    with connection() as conn:
        return conn.execute(
            """
            SELECT count(*) AS count FROM staging_pages
            WHERE batch_id = %s AND pdf_key IS NOT NULL
              AND match_status NOT IN ('MATCHED', 'DISCARDED', 'SUPERSEDED')
            """,
            (batch_id,),
        ).fetchone()["count"]


def _render_from_pdf(pdf_key: str) -> tuple[bytes, int]:
    cfg = settings()
    with tempfile.TemporaryDirectory() as directory:
        pdf_path = os.path.join(directory, "certificate.pdf")
        download_to_file(pdf_key, pdf_path)
        source_size = os.path.getsize(pdf_path)
        with pymupdf.open(pdf_path) as doc:
            if doc.page_count != 1:
                raise ValueError(f"PDF รายใบมี {doc.page_count} หน้า แทนที่จะมี 1 หน้า")
            data = render_webp(doc[0], cfg.cert_image_dpi, cfg.cert_image_quality)

    validate_webp(data)
    return data, source_size


def _render_from_webp(key: str) -> tuple[bytes, int]:
    cfg = settings()
    original = download_bytes(key)
    with Image.open(io.BytesIO(original)) as source:
        if source.format != "WEBP":
            raise ValueError("ไฟล์รูปเดิมไม่ใช่ WebP จึงไม่สามารถบีบอัดซ้ำได้")
        image = source.convert("RGB")
        # คีย์รุ่นเก่าที่ไม่มี d<DPI> สร้างด้วยค่าเดิม 180 DPI
        match = re.search(r"/d(\d+)/q\d+/", key)
        source_dpi = int(match.group(1)) if match else 180
        if cfg.cert_image_dpi < source_dpi:
            size = (
                max(1, round(image.width * cfg.cert_image_dpi / source_dpi)),
                max(1, round(image.height * cfg.cert_image_dpi / source_dpi)),
            )
            image = image.resize(size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=cfg.cert_image_quality, method=4)
        data = buffer.getvalue()
    validate_webp(data)
    return data, len(original)


def _translate_approved_snapshot(conn: Any, row: dict[str, Any], new_key: str) -> None:
    entry_id = row["roster_entry_id"]
    if not entry_id:
        return
    entry = conn.execute(
        "SELECT supplemental_only_snapshot FROM roster_entries WHERE id = %s FOR UPDATE",
        (entry_id,),
    ).fetchone()
    snapshot = entry["supplemental_only_snapshot"] if entry else None
    if not snapshot:
        return
    try:
        items = json.loads(snapshot)
    except (TypeError, ValueError):
        return
    if not isinstance(items, list):
        return

    changed = False
    previous_asset_key = row["certificate_pdf_key"] or row["preview_key"]
    for item in items:
        if (
            isinstance(item, list) and len(item) == 3
            and item[0] == row["certificate_id"] and item[2] == previous_asset_key
        ):
            item[2] = new_key
            changed = True
    if changed:
        conn.execute(
            "UPDATE roster_entries SET supplemental_only_snapshot = %s WHERE id = %s",
            (json.dumps(items, ensure_ascii=False, separators=(",", ":")), entry_id),
        )


def _switch_to_webp(batch_id: str, row: dict[str, Any], new_key: str) -> None:
    """สลับสองแถวพร้อมบันทึกคีย์เก่าใน transaction เดียว"""
    with connection() as conn, conn.transaction():
        certificate = conn.execute(
            """
            SELECT id FROM certificates
            WHERE id = %s
              AND pdf_key IS NOT DISTINCT FROM %s
              AND preview_key IS NOT DISTINCT FROM %s
              AND files_deleted_at IS NULL
            FOR UPDATE
            """,
            (row["certificate_id"], row["certificate_pdf_key"], row["preview_key"]),
        ).fetchone()
        if certificate is None:
            raise StaleAsset(row["page_id"])

        page = conn.execute(
            """
            UPDATE staging_pages SET pdf_key = NULL, preview_key = %s
            WHERE id = %s
              AND pdf_key IS NOT DISTINCT FROM %s
              AND preview_key IS NOT DISTINCT FROM %s
            RETURNING id
            """,
            (new_key, row["page_id"], row["staging_pdf_key"], row["staging_preview_key"]),
        ).fetchone()
        if page is None:
            raise StaleAsset(row["page_id"])

        conn.execute(
            "UPDATE certificates SET pdf_key = NULL, preview_key = %s WHERE id = %s",
            (new_key, row["certificate_id"]),
        )
        _translate_approved_snapshot(conn, row, new_key)
        old_pdfs = list(dict.fromkeys(
            key for key in (row["certificate_pdf_key"], row["staging_pdf_key"]) if key
        ))
        old_previews = list(dict.fromkeys(
            key for key in (row["preview_key"], row["staging_preview_key"])
            if key and key != new_key
        ))
        for index in range(max(len(old_pdfs), len(old_previews))):
            conn.execute(
                """
                INSERT INTO asset_cleanup (id, batch_id, old_pdf_key, old_preview_key)
                VALUES (%s, %s, %s, %s)
                """,
                (new_id(), batch_id,
                 old_pdfs[index] if index < len(old_pdfs) else None,
                 old_previews[index] if index < len(old_previews) else None),
            )


def drain_asset_cleanup(
    batch_id: str, on_progress: ProgressFn | None = None
) -> dict[str, Any]:
    """ตรวจการอ้างอิงและลบไฟล์เก่าจาก ledger เป็นชุด; ล้มเหลวแล้วรันซ้ำได้"""
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT id, old_pdf_key, old_preview_key FROM asset_cleanup
            WHERE batch_id = %s AND completed_at IS NULL ORDER BY created_at
            """,
            (batch_id,),
        ).fetchall()
    completed = failed = 0
    for start in range(0, len(rows), 100):
        chunk = rows[start:start + 100]
        candidates: list[tuple[Any, list[str]]] = []
        for row in chunk:
            keys = list(dict.fromkeys(
                key for key in (row["old_pdf_key"], row["old_preview_key"]) if key
            ))
            if not keys or any(not (
                key.startswith(f"certificates/{batch_id}/")
                or key.startswith(f"previews/{batch_id}/")
            ) for key in keys):
                failed += 1
                log.error("คีย์ไฟล์เก่าของ cleanup %s ไม่ถูกต้อง", row["id"])
                continue
            candidates.append((row["id"], keys))

        if candidates:
            keys = list(dict.fromkeys(key for _, pair in candidates for key in pair))
            try:
                with connection() as conn:
                    used = conn.execute(
                        """
                        SELECT pdf_key AS key FROM certificates WHERE pdf_key = ANY(%s)
                        UNION SELECT preview_key FROM certificates WHERE preview_key = ANY(%s)
                        UNION SELECT pdf_key FROM staging_pages WHERE pdf_key = ANY(%s)
                        UNION SELECT preview_key FROM staging_pages WHERE preview_key = ANY(%s)
                        """,
                        (keys, keys, keys, keys),
                    ).fetchall()
                referenced = {row["key"] for row in used}
                ready = [(row_id, pair) for row_id, pair in candidates
                         if not referenced.intersection(pair)]
                if ready:
                    delete_keys(list(dict.fromkeys(key for _, pair in ready for key in pair)))
                    with connection() as conn:
                        conn.execute(
                            "UPDATE asset_cleanup SET completed_at = NOW() WHERE id = ANY(%s::uuid[])",
                            ([row_id for row_id, _ in ready],),
                        )
                    completed += len(ready)
                failed += len(candidates) - len(ready)
            except Exception:
                failed += len(candidates)
                log.exception("ลบไฟล์เก่าชุดที่เริ่มจาก cleanup %s ไม่สำเร็จ", chunk[0]["id"])
        if on_progress:
            on_progress({"stage": "cleanup", "done": min(start + len(chunk), len(rows)),
                         "total": len(rows), "cleanupCompleted": completed,
                         "pendingCleanup": failed})
    return {"completed": completed, "pendingCleanup": failed}


def finalize_matched_assets(
    batch_id: str,
    revision: str,
    on_progress: ProgressFn,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """ทำทีละใบ; ใบที่พังไม่ทำให้ใบอื่นเสีย และรันซ้ำได้"""
    rows = _pending_pages(batch_id)
    if dry_run:
        with connection() as conn:
            pending_cleanup = conn.execute(
                "SELECT count(*) AS count FROM asset_cleanup WHERE batch_id = %s AND completed_at IS NULL",
                (batch_id,),
            ).fetchone()["count"]
        return {"total": len(rows), "converted": 0, "failed": 0,
                "unresolved": _unresolved_count(batch_id),
                "pendingCleanup": pending_cleanup, "dryRun": True}

    cleanup = drain_asset_cleanup(batch_id, on_progress)
    converted = 0
    failures: list[dict[str, str]] = []
    bytes_before = bytes_after = 0
    for index, row in enumerate(rows, start=1):
        cfg = settings()
        quality = cfg.cert_image_quality
        candidate_key = row["preview_key"]
        use_candidate = is_current_webp_key(
            batch_id, candidate_key, cfg.cert_image_dpi, quality
        )
        new_key = candidate_key if use_candidate else final_webp_key(
            batch_id, row["page_id"], revision, quality, cfg.cert_image_dpi
        )
        created_new = False
        try:
            source_key = row["source_pdf_key"] or row["preview_key"] or row["staging_preview_key"]
            if not source_key:
                raise ValueError("ไม่พบทั้ง PDF และ WebP ต้นทาง")
            if use_candidate:
                data = download_bytes(new_key)
                validate_webp(data)
                source_size = None
            else:
                data, source_size = (
                    _render_from_pdf(source_key) if row["source_pdf_key"]
                    else _render_from_webp(source_key)
                )
                upload_bytes(new_key, data, "image/webp")
                created_new = True
            metadata = head_object(new_key)
            if metadata.get("ContentLength") != len(data) or metadata.get("ContentType") != "image/webp":
                raise ValueError("ตรวจไฟล์ WebP หลังอัปโหลดไม่ผ่าน")
            _switch_to_webp(batch_id, row, new_key)
            converted += 1
            bytes_after += len(data)
            if source_size is not None:
                bytes_before += source_size
        except Exception as exc:
            log.exception("แปลงใบ %s ไม่สำเร็จ", row["page_id"])
            failures.append({"pageId": row["page_id"], "reason": str(exc)[:200]})
            # ถ้าแถวไม่สลับแล้วรูปใหม่ไม่ถูกอ้าง ลบทิ้ง; ไฟล์เดิมยังอยู่
            if created_new:
                try:
                    with connection() as conn:
                        active = conn.execute(
                            "SELECT 1 FROM certificates WHERE preview_key = %s "
                            "UNION ALL SELECT 1 FROM staging_pages WHERE preview_key = %s LIMIT 1",
                            (new_key, new_key),
                        ).fetchone()
                    if not active:
                        delete_keys([new_key])
                except Exception:
                    log.exception("ลบรูปที่สร้างค้างไม่สำเร็จ: %s", new_key)
        if index % 25 == 0 or index == len(rows):
            on_progress({"stage": "webp", "done": index, "total": len(rows),
                         "converted": converted, "failed": len(failures)})

    after_cleanup = drain_asset_cleanup(batch_id, on_progress)
    return {
        "total": len(rows), "converted": converted, "failed": len(failures),
        "unresolved": _unresolved_count(batch_id),
        "failures": failures[:20], "bytesBefore": bytes_before, "bytesAfter": bytes_after,
        "pendingCleanup": after_cleanup["pendingCleanup"],
        "cleanupCompleted": cleanup["completed"] + after_cleanup["completed"],
    }
