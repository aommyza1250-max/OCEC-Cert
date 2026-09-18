"""สร้างรูปตัวอย่างใหม่จาก PDF ใบเดี่ยวที่เก็บไว้แล้ว

ใช้ตอนเปลี่ยนค่า PREVIEW_DPI / PREVIEW_QUALITY แล้วอยากให้ของที่นำเข้าไปแล้วเปลี่ยนตาม
(รูปสร้างครั้งเดียวตอนนำเข้า ไม่ได้สร้างใหม่ทุกครั้งที่เปิดหน้าเว็บ)

    python scripts/rerender_previews.py --batch <id> --dry-run
    python scripts/rerender_previews.py --batch <id>
    python scripts/rerender_previews.py --all

อ่าน PDF ใบเดี่ยวจาก R2 ทีละไฟล์แล้วเขียนรูปทับที่ key เดิม
ไม่แตะฐานข้อมูลเลย เพราะ key ไม่เปลี่ยน — รันซ้ำได้ไม่มีผลข้างเคียง
"""

import argparse
import io
import sys

import pymupdf

from app.config import settings
from app.db import connection
from app.storage import download_bytes, upload_bytes
from app.tasks.render_preview import render_webp


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--batch", help="รหัสรอบการนำเข้า")
    group.add_argument("--all", action="store_true", help="ทุกรอบการนำเข้า")
    parser.add_argument("--dry-run", action="store_true", help="บอกว่าจะทำอะไร โดยไม่เขียนอะไรจริง")
    args = parser.parse_args()

    cfg = settings()
    rows = _load_pages(args.batch)
    if not rows:
        print("ไม่พบหน้าที่มีทั้งไฟล์ PDF และรูปตัวอย่าง")
        return 0

    print(f"จะสร้างรูปใหม่ {len(rows)} ใบ ที่ {cfg.preview_dpi} DPI / quality {cfg.preview_quality}")
    if args.dry_run:
        for row in rows[:5]:
            print(f"  {row['preview_key']}")
        if len(rows) > 5:
            print(f"  ... และอีก {len(rows) - 5} ใบ")
        print("(dry-run ไม่ได้เขียนอะไร)")
        return 0

    before = after = 0
    for index, row in enumerate(rows, start=1):
        pdf = download_bytes(row["pdf_key"])
        with pymupdf.open(stream=pdf, filetype="pdf") as doc:
            image = render_webp(doc[0], cfg.preview_dpi, cfg.preview_quality)

        try:
            before += len(download_bytes(row["preview_key"]))
        except Exception:  # รูปเดิมหายไปแล้วก็ไม่เป็นไร ถือว่าเริ่มจากศูนย์
            pass
        after += len(image)

        upload_bytes(row["preview_key"], image, "image/webp")
        if index % 25 == 0 or index == len(rows):
            print(f"  {index}/{len(rows)}")

    print(f"เสร็จแล้ว: {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")
    return 0


def _load_pages(batch_id: str | None) -> list[dict]:
    sql = """
        SELECT pdf_key, preview_key FROM staging_pages
        WHERE pdf_key IS NOT NULL AND preview_key IS NOT NULL
    """
    params: tuple = ()
    if batch_id:
        sql += " AND batch_id = %s"
        params = (batch_id,)
    sql += " ORDER BY batch_id, page_number"

    with connection() as conn:
        return conn.execute(sql, params).fetchall()


if __name__ == "__main__":
    sys.exit(main())
