"""ตัวช่วยที่ทุกโปรไฟล์ใช้ร่วมกัน — เป็นฟังก์ชันล้วน ไม่มีสถานะ ไม่ผูกกับรายการใด"""

import re

from .base import INVISIBLE, NAME_PATTERN


def page_lines(text: str) -> list[str]:
    """ตัดเป็นบรรทัด ยุบช่องว่างซ้ำ และทิ้งบรรทัดว่าง

    ต้องยุบช่องว่างก่อนเทียบ เพราะ PDF มักแทรกช่องว่างระหว่างตัวอักษรเพื่อจัดระยะ
    """
    return [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]


def validate_name(name: str | None) -> str | None:
    """ชื่อบนเกียรติบัตรเป็นอังกฤษพิมพ์ใหญ่ล้วนเสมอ

    ถ้าไม่เข้ารูปแบบ แปลว่าหยิบผิดบรรทัด (เช่นไปได้ชื่อการแข่งขันหรือข้อความประกอบมา)
    คืน None ดีกว่าคืนค่าผิด เพราะชื่อผิดจะทำให้จับคู่ผิดคน
    """
    if not name:
        return None
    name = name.translate(INVISIBLE).strip()
    return name if NAME_PATTERN.fullmatch(name) else None


def line_after(lines: list[str], anchor: str) -> str | None:
    """บรรทัดถัดจากบรรทัดที่เป็น anchor พอดี"""
    for index, line in enumerate(lines[:-1]):
        if line == anchor:
            return lines[index + 1]
    return None


def line_before_prefix(lines: list[str], prefix: str) -> str | None:
    """บรรทัดก่อนบรรทัดแรกที่ขึ้นต้นด้วย prefix (หรือเป็นคำนั้นลอย ๆ)

    ของจริงมีหน้าที่บรรทัด from เหลือแค่คำว่า "from" (ต้นทางไม่ได้ใส่ค่ามา)
    ยังต้องใช้เป็นจุดยึดหาชื่อได้ ไม่งั้นคนคนนั้นจะหลุดจากระบบทั้งที่ชื่อพิมพ์อยู่บนหน้า
    """
    bare = prefix.strip()
    for index, line in enumerate(lines):
        if index > 0 and (line.startswith(prefix) or line == bare):
            return lines[index - 1]
    return None


def split_subject(level: str) -> tuple[str, str | None]:
    """แยกระดับชั้นกับวิชา: 'PRIMARY 2 in SCRATCH' -> ('PRIMARY 2', 'SCRATCH')

    ชีทรายชื่อเขียนแค่ระดับชั้น ถ้าเก็บวิชาติดไปด้วย การเทียบระดับชั้นจะไม่ตรงทุกแถว
    """
    head, sep, tail = level.partition(" in ")
    if not sep:
        return level, None
    return head.strip(" ,."), (tail.strip(" ,.") or None)


# ใบรางวัลพิเศษรอบ Final ของ HKISO/HKICO ใช้อีกแบบฟอร์ม:
#   achieved CHAMPION in PRIMARY 3,
#   achieved 1ST RUNNER-UP in SECONDARY 1 in BLOCKLY,
ACHIEVED_PREFIX = "achieved "


def split_achievement(line: str) -> tuple[str | None, str]:
    """'achieved CHAMPION in PRIMARY 3' -> ('CHAMPION', 'PRIMARY 3')"""
    body = line[len(ACHIEVED_PREFIX):] if line.startswith(ACHIEVED_PREFIX) else line
    head, sep, tail = body.partition(" in ")
    if not sep:
        return None, body.strip(" ,.")
    return head.strip(" ,.") or None, tail.strip(" ,.")


# บรรทัดชื่องานของใบรางวัลพิเศษไม่มีคำว่า Final/Heat Round มีแค่ชื่อกิจกรรมกับปี
# เช่น "... Science Olympiad Experiment 2025 - 2026,"
EVENT_YEAR_PATTERN = re.compile(
    r"\b(Experiment|Project)\s+(\d{4})(?:\s*[-–]\s*(\d{4}))?", re.IGNORECASE
)


def event_year(lines: list[str]) -> tuple[str | None, int | None, int | None]:
    """ปีจากบรรทัดชื่อกิจกรรมของใบรางวัลพิเศษ — ไม่มีรอบให้อ่าน คืน (None, ปีต้น, ปีท้าย)"""
    for line in lines:
        found = EVENT_YEAR_PATTERN.search(line)
        if found:
            start = int(found.group(2))
            return None, start, int(found.group(3)) if found.group(3) else start
    return None, None, None


def event_name(lines: list[str]) -> dict[str, str]:
    """ชื่อกิจกรรมของใบรางวัลพิเศษ (Experiment / Project) ไว้แสดงให้แอดมินเห็น"""
    for line in lines:
        found = EVENT_YEAR_PATTERN.search(line)
        if found:
            return {"event": found.group(1).title()}
    return {}
