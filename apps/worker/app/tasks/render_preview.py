"""เรนเดอร์หน้า PDF เป็นรูป WebP

MuPDF เขียน WebP เองไม่ได้ จึงเรนเดอร์เป็น PNG ก่อนแล้วให้ Pillow แปลงต่อ
เลือก WebP เพราะไฟล์เล็กกว่า JPEG ที่คุณภาพเท่ากันราว 25-30%
ซึ่งสำคัญมากตอนมีคนเปิดหน้าค้นหาพร้อมกัน 500-600 คน
"""

import io
from typing import Any

from PIL import Image


def render_webp(page: Any, dpi: int = 110, quality: int = 80) -> bytes:
    pixmap = page.get_pixmap(dpi=dpi, alpha=False)
    image = Image.open(io.BytesIO(pixmap.tobytes("png")))

    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=quality, method=4)
    return buffer.getvalue()
