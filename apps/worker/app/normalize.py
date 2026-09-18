"""กฎ normalize ชื่อ (ฝั่ง Python)

⚠️ ไฟล์นี้ต้องให้ผลลัพธ์ตรงกับ apps/web/src/lib/normalize.ts ทุกกรณี
สเปก: docs/name-normalization.md
เทส: apps/worker/tests/test_normalize.py (อ่านเคสจาก shared/normalize-cases.json)

ถ้าแก้ไฟล์นี้ ต้องแก้ฝั่ง TypeScript ด้วยเสมอ ไม่งั้นการ match จะพังแบบเงียบ ๆ
"""

import re
import unicodedata

# ตัดแบบ "ขึ้นต้นด้วย" ไม่ต้องมีช่องว่างคั่น เพราะภาษาไทยเขียนติดกัน
# ลำดับสำคัญมาก: ยาวก่อนสั้น ไม่งั้น "นางสาว" จะโดน "นาง" ตัดก่อน
THAI_PREFIXES = (
    "เด็กหญิง",
    "เด็กชาย",
    "ว่าที่ร้อยตรี",
    "นางสาว",
    "นาง",
    "นาย",
    "ด ช",
    "ด ญ",
    "น ส",
    "ดช",
    "ดญ",
    "นส",
)

# ตัดแบบ "เป็นคำแรก" ต้องมีช่องว่างตามหลัง
# ไม่งั้นชื่อจริงอย่าง MRINAL จะถูกตัดเหลือ INAL
LATIN_PREFIXES = ("MASTER", "MISS", "PROF", "MRS", "MR", "MS", "DR")

_COMBINING = re.compile(r"[̀-ͯ]")
# เก็บเฉพาะ: ละติน, ตัวเลข, อักขระไทย — ที่เหลือกลายเป็นช่องว่าง
_DISALLOWED = re.compile(r"[^A-Za-z0-9฀-๿]+")
_WHITESPACE = re.compile(r"\s+")

_MAX_PREFIX_PASSES = 3


def basic_clean(raw: str) -> str:
    """ขั้นตอนทำความสะอาดพื้นฐาน (ขั้นที่ 1-4) ที่ทั้งชื่อคน ชื่อโรงเรียน และรางวัลใช้ร่วมกัน

    1. NFD -> ลบ combining diacritic -> NFC
    2. อักขระที่ไม่อนุญาต -> ช่องว่าง
    3. ยุบช่องว่าง + ตัดหัวท้าย
    4. พิมพ์ใหญ่ (ไม่กระทบตัวอักษรไทย)
    """
    if not raw:
        return ""
    text = unicodedata.normalize("NFD", raw)
    text = _COMBINING.sub("", text)
    text = unicodedata.normalize("NFC", text)
    text = _DISALLOWED.sub(" ", text)
    return _WHITESPACE.sub(" ", text).strip().upper()


def normalize_name(raw: str) -> str:
    """แปลงชื่อให้เป็นรูปมาตรฐาน โดยคงลำดับคำไว้"""
    text = basic_clean(raw)
    if not text:
        return ""

    # ขั้นที่ 5: ตัดคำนำหน้า วนจนไม่มีอะไรถูกตัด
    for _ in range(_MAX_PREFIX_PASSES):
        stripped = _strip_one_prefix(text)
        if stripped == text:
            break
        text = stripped

    # ขั้นที่ 6: ยุบช่องว่าง + ตัดหัวท้าย อีกรอบ
    return _WHITESPACE.sub(" ", text).strip()


def _strip_one_prefix(text: str) -> str:
    for prefix in THAI_PREFIXES:
        if text.startswith(prefix):
            return text[len(prefix):].lstrip()
    for prefix in LATIN_PREFIXES:
        if text.startswith(prefix + " "):
            return text[len(prefix) + 1:].lstrip()
    return text


# ---------------------------------------------------------------- รางวัล

# คำที่ไม่ได้ช่วยระบุว่าเป็นรางวัลอะไร ต่างแหล่งเติมมาไม่เหมือนกัน
# Excel เขียน "GOLD AWARD" / "PERFECT SCORER" ส่วนโฟลเดอร์เขียนแค่ "Gold"
AWARD_NOISE = frozenset({"AWARD", "AWARDS", "SCORER", "SCORERS", "MEDAL", "PRIZE"})

# ค่ามาตรฐาน 6 ค่าที่ระบบใช้ทั้งในชื่อไฟล์และฐานข้อมูล
#
# PARTICIPATION (รางวัลเข้าร่วม) มีเฉพาะรอบคัดเลือก และมีจำนวนเยอะที่สุดในรอบนั้น
# ของจริงที่เจอ: HKIMO Heat 2026 มี 277 ใบ, BBB มี 115 ใบ
#
# 1st/2nd/3rd Prize เป็นคำที่รายการ BBB (粵港澳大灣區數學競賽) ใช้เรียกเหรียญ
# ชื่อโฟลเดอร์ยังเป็น Gold/Silver/Bronze เหมือนเดิม ที่ต้องรู้จักคำพวกนี้ด้วย
# เพราะข้อความบนหน้าใช้เทียบยืนยันกับชื่อโฟลเดอร์
AWARD_CANONICAL = {
    "GOLD": "GOLD",
    "1ST": "GOLD",
    "SILVER": "SILVER",
    "2ND": "SILVER",
    "BRONZE": "BRONZE",
    "3RD": "BRONZE",
    "MERIT": "MERIT",
    "PERFECT": "PERFECT_SCORE",
    "PERFECT_SCORE": "PERFECT_SCORE",
    "PARTICIPATION": "PARTICIPATION",
}

# ชื่อรางวัลภาษาไทย — เรียงจากเจาะจงไปกว้าง ("ทองแดง" ต้องมาก่อน "ทอง")
AWARD_THAI = (
    ("ทองแดง", "BRONZE"),
    ("ทอง", "GOLD"),
    ("เงิน", "SILVER"),
    ("ชมเชย", "MERIT"),
    ("คะแนนเต็ม", "PERFECT_SCORE"),
    ("เข้าร่วม", "PARTICIPATION"),
)


def normalize_award(raw: str) -> str:
    """แปลงชื่อรางวัลให้เป็นค่ามาตรฐาน 1 ใน 6 ค่า

    รางวัลมาจาก 3 แหล่งที่สะกดไม่เหมือนกันเลย:
      ชื่อโฟลเดอร์ใน ZIP   "Gold", "Perfect_Score"
      ข้อความบนเกียรติบัตร "Gold Award"
      คอลัมน์ AWARD ใน Excel "GOLD AWARD", "PERFECT SCORER"

    รางวัลที่ไม่รู้จักคืนค่าว่าง ไม่ใช่เดา — เพราะรางวัลผิดจะไปโผล่บนหน้าเว็บของเด็ก
    ผู้เรียกต้องตัดสินเองว่าจะหยุดงาน (กรณีชื่อโฟลเดอร์) หรือแค่เตือน (กรณี cross-check)
    """
    text = basic_clean(raw)
    if not text:
        return ""

    for thai, canonical in AWARD_THAI:
        if thai in text:
            return canonical

    # "3rdPrize" เขียนติดกันไม่มีเว้นวรรค ต้องแยกเลขลำดับออกจากคำก่อน
    text = re.sub(r"\b(\d+(?:ST|ND|RD|TH))(?=[A-Z])", r"\1 ", text)

    tokens = [t for t in text.split(" ") if t and t not in AWARD_NOISE]
    return AWARD_CANONICAL.get("_".join(tokens), "")


# ---------------------------------------------------------------- โรงเรียน

# คำนำหน้าชื่อโรงเรียนที่ไม่ได้ช่วยแยกความต่าง — เขียนบ้างไม่เขียนบ้างในไฟล์เดียวกัน
# ภาษาไทยตัดแบบ "ขึ้นต้นด้วย" ได้เลยเพราะเขียนติดกัน
THAI_SCHOOL_PREFIXES = ("โรงเรียน", "รร")
# ภาษาอังกฤษต้องมีช่องว่างตามหลัง ไม่งั้นชื่อจริงอย่าง THEPSIRIN จะถูกตัดเหลือ PSIRIN
LATIN_SCHOOL_PREFIXES = ("SCHOOL", "THE")


def normalize_school(raw: str) -> str:
    """แปลงชื่อโรงเรียนให้เทียบกันได้

    ใช้แยกคนที่ชื่อพ้องกัน — ชื่ออย่างเดียวไม่พอที่จะบอกว่าเป็นคนเดียวกัน

    ต่างจาก normalize_name ตรงที่ **ตัดช่องว่างทิ้งทั้งหมด** เพราะชื่อโรงเรียนไทย
    เขียนเว้นวรรคไม่เหมือนกันในแต่ละไฟล์ ("สวนกุหลาบวิทยาลัย" กับ "สวนกุหลาบ วิทยาลัย")
    แต่หมายถึงที่เดียวกัน ส่วนชื่อคนต้องคงช่องว่างไว้เพราะแยกชื่อกับนามสกุล
    """
    text = normalize_name(raw)
    if not text:
        return ""

    for prefix in THAI_SCHOOL_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix):].lstrip()
            break
    else:
        for prefix in LATIN_SCHOOL_PREFIXES:
            if text.startswith(prefix + " "):
                text = text[len(prefix) + 1:].lstrip()
                break

    return _WHITESPACE.sub("", text)


def name_sort_key(raw: str) -> str:
    """normalize แล้วเรียงคำตามตัวอักษร

    ใช้ช่วยจับคู่กรณี Excel เขียน 'นามสกุล ชื่อ' แต่ PDF เขียน 'ชื่อ นามสกุล'
    ห้ามใช้ยืนยันตัวตนเดี่ยว ๆ เพราะสลับคำแล้วอาจเป็นคนละคนจริง
    """
    normalized = normalize_name(raw)
    if not normalized:
        return ""
    return " ".join(sorted(normalized.split(" ")))
