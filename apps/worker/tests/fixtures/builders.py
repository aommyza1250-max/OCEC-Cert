"""สร้างไฟล์ PDF/Excel/ZIP ตัวอย่างขึ้นมาสด ๆ สำหรับเทส

ตั้งใจสร้างด้วยโค้ดแทนการ commit ไฟล์จริง เพราะเกียรติบัตรจริงมีข้อมูลส่วนบุคคล
ห้ามนำไฟล์จริงเข้า git เด็ดขาด

โครงหน้าเลียนแบบไฟล์จริงที่สำรวจไว้ใน docs/pdf-parsing-notes.md รวมถึงจุดที่ทำให้พลาดได้:
  - บรรทัดลายเซ็นกรรมการโผล่ "ก่อน" เนื้อหาจริงในลำดับข้อความที่สกัดได้
  - ชื่องานถูกแตกเป็นบรรทัดละตัวอักษร (วิธีหาชื่อแบบ "ฟอนต์ใหญ่สุด" จึงใช้ไม่ได้)
  - หน้า Perfect Score ไม่มีบรรทัดรางวัลเลย
"""

import io
import zipfile

import pymupdf
from openpyxl import Workbook

A4_LANDSCAPE = (842, 595)

DECORATIVE_TITLE = "HONG KONG INTERNATIONAL MATHEMATICAL OLYMPIAD"


def make_bundle_pdf(entries: list[dict]) -> bytes:
    """สร้าง PDF รวมเล่ม หน้าละ 1 คน

    entries แต่ละตัวรับคีย์:
      name     ชื่อผู้รับ (อังกฤษพิมพ์ใหญ่)
      country  สัญชาติ — ใส่แล้วจะเกิดบรรทัด "from <country>"
      level    ระดับชั้น เช่น "PRIMARY 3"
      cert_no  เลขบนหน้า — ใส่แล้วจะเกิดบรรทัด "Cert No: <cert_no>"
      award    ข้อความรางวัล เช่น "Gold" -> พิมพ์เป็น "Gold Award"
               ไม่ใส่ = ไม่มีบรรทัดรางวัล (เลียนแบบหน้า Perfect Score ของจริง)
      round    "Final" หรือ "Heat" (ปริยาย Final)
      year     ปี ค.ศ. (ปริยาย 2026)
      anchor   ใส่ False เพื่อไม่พิมพ์บรรทัด "This is awarded to"
    """
    doc = pymupdf.open()
    for entry in entries:
        page = doc.new_page(width=A4_LANDSCAPE[0], height=A4_LANDSCAPE[1])
        write, write_inline_chars = _writer(page)

        # ลายเซ็นกรรมการ — ของจริงโผล่เป็นบรรทัดแรก ๆ ของข้อความที่สกัดได้
        write("Tangent Wong", 9)
        write("Director", 9)
        write("Andy Lam", 9)
        write("President", 9)

        # ชื่องานที่ถูกแตกเป็นบรรทัดละตัวอักษรในข้อความที่สกัดได้
        # ของจริงเรียงแนวนอนบนหน้ากระดาษ (จัดระยะตัวอักษร) แต่ออกมาเป็นคนละบรรทัด
        write_inline_chars(DECORATIVE_TITLE)

        if entry.get("award"):
            write(f"{entry['award']} Award", 20)
        if entry.get("anchor", True):
            write("This is awarded to", 14)
        write(entry["name"], 26)
        if entry.get("country"):
            write(f"from {entry['country']}", 13)
        if entry.get("level"):
            write(f"for outstanding achievement in {entry['level']},", 12)

        round_name = entry.get("round", "Final")
        year = entry.get("year", 2026)
        write(f"Hong Kong International Mathematical Olympiad {round_name} Round {year},", 11)
        write(f"22nd - 23rd August {year}, Hong Kong & worldwide", 11)
        if entry.get("cert_no"):
            write(f"Cert No: {entry['cert_no']}", 10)
        write(f"23rd Aug {year}", 10)

    data = doc.tobytes()
    doc.close()
    return data


def _writer(page):
    """เขียนข้อความไล่จากบนลงล่าง — ลำดับที่เขียนคือลำดับที่ get_text อ่านได้

    คืน (write, write_inline_chars) โดย write_inline_chars ใช้เขียนตัวอักษรเรียงแนวนอน
    บนบรรทัดเดียว แต่ละตัวเป็นคนละ span จึงถูกสกัดออกมาเป็นคนละบรรทัด — เหมือนของจริง
    """
    state = {"y": 40}

    def write(text: str, size: float) -> None:
        state["y"] += size + 2
        page.insert_text((60, state["y"]), text, fontsize=size, fontname="helv")

    def write_inline_chars(text: str, size: float = 9) -> None:
        state["y"] += size + 2
        x = 60
        for char in text:
            page.insert_text((x, state["y"]), char, fontsize=size, fontname="helv")
            x += size

    return write, write_inline_chars


def make_award_zip(bundles: dict[str, bytes], extra_files: dict[str, bytes] | None = None) -> bytes:
    """บีบไฟล์รวมเล่มเป็น ZIP โดยแยกโฟลเดอร์ตามรางวัล ตามที่แอดมินจะอัปโหลดจริง

    bundles:     {"Gold": <pdf bytes>, "Perfect_Score": <pdf bytes>}
    extra_files: ไฟล์อื่น ๆ ที่อยากใส่เพิ่ม เช่นขยะจาก macOS หรือ PDF ที่วางผิดที่
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder, pdf in bundles.items():
            zf.writestr(f"{folder}/THAILAND_{folder}.pdf", pdf)
        for path, data in (extra_files or {}).items():
            zf.writestr(path, data)
    return buffer.getvalue()


def make_roster_xlsx(
    rows: list[dict[str, str]],
    headers: dict[str, str] | None = None,
    junk_rows_before_header: int = 0,
) -> bytes:
    """สร้างไฟล์รายชื่อ Excel

    headers: แมปจาก key ของ row -> ข้อความหัวคอลัมน์ ใช้ทดสอบว่าระบบอ่านหัวตารางหลายแบบได้
             ปริยายใช้หัวตารางแบบเดียวกับไฟล์จริง
    junk_rows_before_header: จำลองไฟล์ที่มีหัวกระดาษอยู่เหนือหัวตาราง
    """
    headers = headers or {
        "cert_no": "CANDIDATE NO",
        "level": "GRADE",
        "name_en": "CANDIDATE NAME",
        "award": "AWARD",
    }
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
