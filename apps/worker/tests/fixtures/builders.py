"""สร้างไฟล์ PDF/Excel ตัวอย่างขึ้นมาสด ๆ สำหรับเทส

ตั้งใจสร้างด้วยโค้ดแทนการ commit ไฟล์จริง เพราะเกียรติบัตรจริงมีข้อมูลส่วนบุคคล
ห้ามนำไฟล์จริงเข้า git เด็ดขาด

โครงหน้าเลียนแบบเกียรติบัตรจริงที่สำรวจไว้ใน docs/pdf-parsing-notes.md:

    Certificate No: 12345
    This is awarded to
    SOMCHAI JAIDEE
    from THAILAND
    for outstanding achievement in Primary 5
"""

import io

import pymupdf
from openpyxl import Workbook

A4_LANDSCAPE = (842, 595)


def make_bundle_pdf(entries: list[dict]) -> bytes:
    """สร้าง PDF รวมเล่ม หน้าละ 1 คน

    entries แต่ละตัวรับคีย์:
      name     ชื่อผู้รับ (อังกฤษพิมพ์ใหญ่)
      country  สัญชาติ — ใส่แล้วจะเกิดบรรทัด "from <country>"
      level    ระดับชั้น — ใส่แล้วจะเกิดบรรทัด "for outstanding achievement in <level>"
      cert_no  เลขเกียรติบัตร — ใส่แล้วจะเกิดบรรทัด "Certificate No: <cert_no>"
      anchor   ใส่ False เพื่อไม่พิมพ์บรรทัด "This is awarded to"
    """
    doc = pymupdf.open()
    for entry in entries:
        page = doc.new_page(width=A4_LANDSCAPE[0], height=A4_LANDSCAPE[1])
        # ต้องวางจากบนลงล่างตามลำดับจริง เพราะ get_text อ่านตามตำแหน่งบนหน้า
        y = 100
        page.insert_text((150, y), "CERTIFICATE OF ACHIEVEMENT", fontsize=22, fontname="helv")

        if entry.get("cert_no"):
            y += 40
            page.insert_text(
                (150, y), f"Certificate No: {entry['cert_no']}", fontsize=12, fontname="helv"
            )

        if entry.get("anchor", True):
            y += 50
            page.insert_text((150, y), "This is awarded to", fontsize=16, fontname="helv")

        y += 60
        page.insert_text((150, y), entry["name"], fontsize=40, fontname="helv")

        if entry.get("country"):
            y += 50
            page.insert_text((150, y), f"from {entry['country']}", fontsize=16, fontname="helv")

        if entry.get("level"):
            y += 45
            page.insert_text(
                (150, y),
                f"for outstanding achievement in {entry['level']}",
                fontsize=14,
                fontname="helv",
            )

    data = doc.tobytes()
    doc.close()
    return data


def make_roster_xlsx(
    rows: list[dict[str, str]],
    headers: dict[str, str] | None = None,
    junk_rows_before_header: int = 0,
) -> bytes:
    """สร้างไฟล์รายชื่อ Excel

    headers: แมปจาก key ของ row -> ข้อความหัวคอลัมน์ ใช้ทดสอบว่าระบบอ่านหัวตารางหลายแบบได้
    junk_rows_before_header: จำลองไฟล์จริงที่มีหัวกระดาษ/ชื่อหน่วยงานอยู่เหนือหัวตาราง
    """
    headers = headers or {"name_en": "Name", "award": "Award"}
    workbook = Workbook()
    sheet = workbook.active

    for i in range(junk_rows_before_header):
        sheet.append([f"รายงานผลการแข่งขัน แถวที่ {i + 1}"])

    keys = list(headers)
    sheet.append([headers[k] for k in keys])
    for row in rows:
        sheet.append([row.get(k, "") for k in keys])

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
