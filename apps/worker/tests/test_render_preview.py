"""รูปดาวน์โหลดสร้างจาก PDF สังเคราะห์ ไม่แตะข้อมูลเกียรติบัตรจริง"""

import io

import pymupdf
from PIL import Image

from app.tasks.render_preview import render_webp


def test_webp_download_resolution() -> None:
    with pymupdf.open() as doc:
        page = doc.new_page(width=842, height=595)
        page.insert_text((72, 72), "CERTIFICATE 123")
        data = render_webp(page, 150, 85)

    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "WEBP"
        assert 1750 <= image.width <= 1760
        assert 1235 <= image.height <= 1250
