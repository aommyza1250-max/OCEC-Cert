"""จับคู่รายชื่อจาก Excel เข้ากับหน้าที่ตัดแยกไว้แล้ว แล้วบันทึกเป็นเกียรติบัตรจริง

หลักการสำคัญ: **ถ้าไม่มั่นใจ ห้ามเดา**
ชื่อซ้ำกันระหว่างคนละคนเป็นเรื่องปกติ ถ้าชื่อหนึ่งไปตรงกับหลายหน้า ระบบจะทำเครื่องหมาย
AMBIGUOUS แล้วปล่อยให้แอดมินตัดสินเอง ดีกว่าจับคู่ผิดแล้วผู้ปกครองโหลดได้เกียรติบัตรของคนอื่น
"""

import io
import logging
from dataclasses import dataclass
from typing import Any, Callable

from openpyxl import load_workbook

from ..db import connection, new_id
from ..normalize import name_sort_key, normalize_name, normalize_school
from ..storage import download_bytes

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

# หัวคอลัมน์ที่ยอมรับ — เทียบหลังตัดช่องว่างและทำตัวพิมพ์เล็กแล้ว
HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "name_en": ("name", "fullname", "englishname", "nameenglish", "nameen", "nameeng",
                "ชื่อภาษาอังกฤษ", "ชื่ออังกฤษ", "ชื่อ-นามสกุลภาษาอังกฤษ"),
    "first_en": ("firstname", "givenname", "given"),
    "last_en": ("lastname", "surname", "familyname", "family"),
    "name_th": ("ชื่อ-นามสกุล", "ชื่อ-สกุล", "ชื่อนามสกุล", "ชื่อภาษาไทย", "ชื่อไทย",
                "ชื่อ-นามสกุลภาษาไทย", "thainame"),
    "first_th": ("ชื่อ", "ชื่อจริง"),
    "last_th": ("นามสกุล", "สกุล"),
    "exam_code": ("เลขที่นั่งสอบ", "เลขประจำตัวสอบ", "รหัสผู้เข้าสอบ", "รหัสประจำตัว", "รหัส",
                  "seatno", "seatnumber", "examid", "examcode", "code"),
    # เลขเกียรติบัตรที่พิมพ์บนหน้ากระดาษ (No: 12345) — คีย์ที่แม่นที่สุดถ้า Excel มีให้
    # ตั้งใจไม่รับ alias สั้น ๆ อย่าง "no" เพราะตารางไทยมักใช้เป็นคอลัมน์ลำดับแถว
    "cert_no": ("เลขเกียรติบัตร", "เลขที่เกียรติบัตร", "certno", "certificateno",
                "certificatenumber", "certificateid"),
    "award": ("รางวัล", "ผลการแข่งขัน", "ผลรางวัล", "award", "result", "medal", "prize"),
    # โรงเรียน — ใช้แยกคนที่ชื่อพ้องกัน ซึ่งชื่ออย่างเดียวแยกไม่ได้
    "school": ("โรงเรียน", "สถานศึกษา", "ชื่อโรงเรียน", "school", "schoolname", "institution"),
}

MAX_HEADER_SCAN_ROWS = 10
# จำนวนแถวที่จับคู่ไม่ได้ ที่เก็บรายละเอียดไว้ใน stats — เกินกว่านี้เก็บแค่ตัวเลข
MAX_REPORTED_UNMATCHED = 200


@dataclass
class RosterRow:
    row_number: int
    name_en: str
    name_th: str
    exam_code: str
    cert_no: str
    school: str
    award: str


def run_match(batch_id: str, on_progress: ProgressFn) -> dict[str, Any]:
    batch = _load_batch(batch_id)
    if not batch["source_excel_key"]:
        raise ValueError("batch นี้ยังไม่มีไฟล์ Excel รายชื่อ")

    rows = parse_roster(download_bytes(batch["source_excel_key"]))
    log.info("อ่านรายชื่อจาก Excel ได้ %s แถว", len(rows))

    pages = _load_pages(batch_id)
    by_cert_no = _index(pages, "cert_no")
    by_normalized = _index(pages, "extracted_name_normalized")
    by_sort_key = _index(pages, "extracted_name_sort_key")

    stats: dict[str, Any] = {
        "rosterRows": len(rows),
        "matched": 0,
        "ambiguous": 0,
        "rowsNotFound": 0,
        "matchedByCertNo": 0,
        "duplicateNames": 0,
        "unmatchedRows": [],
    }
    used_page_ids: set[str] = set()
    # ผู้เข้าสอบที่ถูกจับคู่ไปแล้วในรอบนี้ — กันไม่ให้สองหน้าที่ชื่อเหมือนกันไปลงคนเดียวกัน
    used_student_ids: set[str] = set()

    for i, row in enumerate(rows, start=1):
        candidates, by_cert = _find_candidates(
            row, by_cert_no, by_normalized, by_sort_key, used_page_ids
        )

        if len(candidates) == 1:
            page = candidates[0]
            used_page_ids.add(page["id"])
            student_id, conflict_page = _resolve_student(
                row, batch["exam_id"], page["id"], used_student_ids
            )

            if student_id is None:
                # ชื่อซ้ำกับหน้าที่จับคู่ไปแล้วในรายการสอบนี้
                # ระบบไม่เดาให้ว่าเป็นคนเดียวกันหรือคนละคน — ส่งให้แอดมินดูใบจริงทั้งสองใบแล้วตัดสิน
                _mark_duplicate_name(page["id"], conflict_page, row)
                stats["duplicateNames"] += 1
            else:
                _commit_match(batch, page, row, student_id)
                stats["matched"] += 1
                if by_cert:
                    stats["matchedByCertNo"] += 1
        elif len(candidates) > 1:
            stats["ambiguous"] += 1
            note = f"ชื่อนี้ตรงกับหน้าในไฟล์ PDF {len(candidates)} หน้า ต้องให้แอดมินเลือกเอง"
            for page in candidates:
                _mark_ambiguous(page["id"], note)
        else:
            stats["rowsNotFound"] += 1
            if len(stats["unmatchedRows"]) < MAX_REPORTED_UNMATCHED:
                stats["unmatchedRows"].append(
                    {"row": row.row_number, "nameEn": row.name_en, "nameTh": row.name_th}
                )

        if i % 25 == 0 or i == len(rows):
            on_progress({"stage": "match", "done": i, "total": len(rows)})

    # หน้าที่ไม่มีใครใน Excel มาอ้างถึง = มีเกียรติบัตรแต่ไม่มีในรายชื่อ ต้องให้แอดมินดู
    stats["pagesUnmatched"] = _count_unmatched_pages(batch_id)

    log.info("จับคู่ batch %s เสร็จ: matched=%s ambiguous=%s notFound=%s",
             batch_id, stats["matched"], stats["ambiguous"], stats["rowsNotFound"])
    return stats


# ---------------------------------------------------------------- อ่าน Excel

def parse_roster(xlsx_bytes: bytes) -> list[RosterRow]:
    workbook = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    sheet = workbook.active

    grid = [list(r) for r in sheet.iter_rows(values_only=True)]
    header_index, columns = _find_header(grid)
    if header_index is None:
        raise ValueError(
            "หาหัวตารางในไฟล์ Excel ไม่เจอ — ต้องมีคอลัมน์ชื่ออย่างน้อย 1 คอลัมน์ "
            f"(ที่รองรับ: {', '.join(sorted(HEADER_ALIASES))})"
        )

    rows: list[RosterRow] = []
    for offset, raw in enumerate(grid[header_index + 1:], start=header_index + 2):
        row = _build_row(raw, columns, offset)
        # ข้ามแถวว่างและแถวรวมยอดท้ายตาราง
        if row and (row.name_en or row.name_th):
            rows.append(row)
    return rows


def _find_header(grid: list[list[Any]]) -> tuple[int | None, dict[str, int]]:
    for index, raw in enumerate(grid[:MAX_HEADER_SCAN_ROWS]):
        columns: dict[str, int] = {}
        for col, cell in enumerate(raw):
            field = _match_header(cell)
            # คอลัมน์แรกที่เจอชนะ กันกรณีมีหัวซ้ำ
            if field and field not in columns:
                columns[field] = col
        if _has_name_column(columns):
            return index, columns
    return None, {}


def _match_header(cell: Any) -> str | None:
    if cell is None:
        return None
    key = "".join(str(cell).split()).lower().replace("_", "").replace(".", "")
    if not key:
        return None
    for field, aliases in HEADER_ALIASES.items():
        if key in aliases:
            return field
    return None


def _has_name_column(columns: dict[str, int]) -> bool:
    return bool(
        {"name_en", "name_th"} & columns.keys()
        or {"first_en", "last_en"} <= columns.keys()
        or {"first_th", "last_th"} <= columns.keys()
    )


def _build_row(raw: list[Any], columns: dict[str, int], row_number: int) -> RosterRow | None:
    def value(field: str) -> str:
        col = columns.get(field)
        if col is None or col >= len(raw) or raw[col] is None:
            return ""
        return str(raw[col]).strip()

    name_en = value("name_en") or " ".join(x for x in (value("first_en"), value("last_en")) if x)
    name_th = value("name_th") or " ".join(x for x in (value("first_th"), value("last_th")) if x)

    if not name_en and not name_th:
        return None
    return RosterRow(
        row_number=row_number,
        name_en=name_en,
        name_th=name_th,
        exam_code=value("exam_code"),
        cert_no=_digits_only(value("cert_no")),
        school=value("school"),
        award=value("award"),
    )


def _digits_only(text: str) -> str:
    """Excel มักอ่านเลขเกียรติบัตรมาเป็น '12345.0' หรือมีช่องว่างปน ตัดให้เหลือแต่ตัวเลข"""
    return "".join(ch for ch in text if ch.isdigit())


# ---------------------------------------------------------------- จับคู่

def _index(pages: list[dict[str, Any]], field: str) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for page in pages:
        key = page.get(field)
        if key:
            index.setdefault(key, []).append(page)
    return index


def _find_candidates(
    row: RosterRow,
    by_cert_no: dict[str, list[dict[str, Any]]],
    by_normalized: dict[str, list[dict[str, Any]]],
    by_sort_key: dict[str, list[dict[str, Any]]],
    used: set[str],
) -> tuple[list[dict[str, Any]], bool]:
    """ไล่หาตามลำดับความมั่นใจ

    1. เลขเกียรติบัตร — แม่นที่สุด เพราะไม่ซ้ำกันแม้คนจะชื่อเหมือนกัน
    2. ชื่อที่ normalize แล้ว ตรงเป๊ะ
    3. ชื่อแบบสลับชื่อ-นามสกุลได้

    คืนค่า (รายการที่พบ, จับคู่ด้วยเลขเกียรติบัตรหรือไม่)
    """
    if row.cert_no:
        found = [p for p in by_cert_no.get(row.cert_no, []) if p["id"] not in used]
        if found:
            return found, True

    attempts = (
        (by_normalized, normalize_name(row.name_en)),
        (by_normalized, normalize_name(row.name_th)),
        (by_sort_key, name_sort_key(row.name_en)),
        (by_sort_key, name_sort_key(row.name_th)),
    )
    for index, key in attempts:
        if not key:
            continue
        found = [p for p in index.get(key, []) if p["id"] not in used]
        if found:
            return found, False
    return [], False


# ---------------------------------------------------------------- เขียนฐานข้อมูล

def _commit_match(
    batch: dict[str, Any], page: dict[str, Any], row: RosterRow, student_id: str
) -> None:
    with connection() as conn:
        with conn.transaction():
            conn.execute(
                """
                UPDATE staging_pages
                SET match_status = 'MATCHED', matched_student_id = %s,
                    matched_manually = false, match_note = NULL
                WHERE id = %s
                """,
                (student_id, page["id"]),
            )
            conn.execute(
                """
                INSERT INTO certificates
                  (id, student_id, exam_id, batch_id, staging_page_id,
                   pdf_key, preview_key, page_number, award, cert_no, level)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (exam_id, student_id) DO UPDATE
                SET staging_page_id = EXCLUDED.staging_page_id,
                    batch_id = EXCLUDED.batch_id,
                    pdf_key = EXCLUDED.pdf_key,
                    preview_key = EXCLUDED.preview_key,
                    page_number = EXCLUDED.page_number,
                    award = EXCLUDED.award,
                    cert_no = EXCLUDED.cert_no,
                    level = EXCLUDED.level
                """,
                (
                    new_id(),
                    student_id,
                    batch["exam_id"],
                    batch["id"],
                    page["id"],
                    page["pdf_key"],
                    page["preview_key"],
                    page["page_number"],
                    row.award or None,
                    # เลขเกียรติบัตรและระดับชั้นอ่านจากหน้ากระดาษ ไม่ใช่จาก Excel
                    # เพราะสิ่งที่พิมพ์อยู่บนเกียรติบัตรคือความจริงที่ผู้ปกครองถืออยู่ในมือ
                    page["cert_no"],
                    page["level"],
                ),
            )


def _resolve_student(
    row: RosterRow, exam_id: str, page_id: str, used: set[str]
) -> tuple[str | None, int | None]:
    """หาว่าหน้านี้เป็นของผู้เข้าสอบคนไหน

    คืน (student_id, None) เมื่อระบุตัวได้แน่นอน หรือสร้างใหม่
    คืน (None, เลขหน้าที่ชนกัน) เมื่อระบุตัวไม่ได้ ต้องให้แอดมินตัดสิน

    ลำดับการระบุตัว:
      1. ชื่อที่ normalize แล้วตรงกัน — ทำให้รวมเกียรติบัตรทุกใบของคนคนนั้นไว้ด้วยกันได้
      2. ถ้าชื่อพ้องกันหลายคน ใช้ "โรงเรียน" แยก เพราะชื่ออย่างเดียวไม่พอ
      3. ถ้ายังแยกไม่ออก (ชื่อเดียวกัน โรงเรียนเดียวกัน) ไม่เดาให้
         ส่งต่อให้แอดมินดูเกียรติบัตรจริงทั้งสองใบแล้วตัดสิน
    """
    name_en_norm = normalize_name(row.name_en) or None
    name_th_norm = normalize_name(row.name_th) or None
    school_norm = normalize_school(row.school) or None

    # ต้อง cast ::text ตรง ๆ ไม่งั้น Postgres เดาชนิดของพารามิเตอร์ใน 'IS NOT NULL' ไม่ออก
    with connection() as conn:
        candidates = conn.execute(
            """
            SELECT id, school_normalized FROM students
            WHERE (%s::text IS NOT NULL AND name_en_normalized = %s)
               OR (%s::text IS NOT NULL AND name_th_normalized = %s)
            ORDER BY created_at
            """,
            (name_en_norm, name_en_norm, name_th_norm, name_th_norm),
        ).fetchall()

        candidates = _narrow_by_school(candidates, school_norm)

        conflict_page: int | None = None
        free = []
        for candidate in candidates:
            student_id = candidate["id"]
            if student_id in used:
                conflict_page = conflict_page or _matched_page_number(conn, exam_id, student_id)
                continue
            other = _other_certificate_page(conn, exam_id, student_id, page_id)
            if other is not None:
                conflict_page = conflict_page or other
                continue
            free.append(student_id)

        if len(free) == 1:
            student_id = free[0]
            _fill_missing_fields(conn, student_id, row, name_th_norm, name_en_norm, school_norm)
            used.add(student_id)
            return student_id, None

        if candidates:
            # มีคนชื่อนี้ (และโรงเรียนนี้) อยู่แล้ว แต่ระบุไม่ได้ว่าเป็นคนไหน
            # อาจเพราะถูกใช้ไปหมดแล้วในรายการสอบนี้ หรือมีหลายคนที่แยกไม่ออก
            return None, conflict_page

        student_id = _create_student(conn, row, name_th_norm, name_en_norm, school_norm)

    used.add(student_id)
    return student_id, None


def _narrow_by_school(
    candidates: list[dict[str, Any]], school_norm: str | None
) -> list[dict[str, Any]]:
    """คัดผู้เข้าสอบชื่อพ้องให้เหลือเฉพาะคนที่อยู่โรงเรียนเดียวกัน

    - เจอคนโรงเรียนเดียวกัน -> เอาเฉพาะกลุ่มนั้น
    - ไม่เจอ แต่มีคนที่ยังไม่เคยบันทึกโรงเรียน -> ถือว่าน่าจะใช่ แล้วค่อยเติมโรงเรียนให้
    - ทุกคนที่ชื่อนี้อยู่คนละโรงเรียน -> เป็นคนใหม่แน่นอน ไม่ต้องถามแอดมิน
    """
    if not school_norm or not candidates:
        return candidates

    same_school = [c for c in candidates if c["school_normalized"] == school_norm]
    if same_school:
        return same_school

    unknown_school = [c for c in candidates if not c["school_normalized"]]
    return unknown_school


def _matched_page_number(conn: Any, exam_id: str, student_id: str) -> int | None:
    row = conn.execute(
        """
        SELECT sp.page_number
        FROM certificates c JOIN staging_pages sp ON sp.id = c.staging_page_id
        WHERE c.exam_id = %s AND c.student_id = %s
        LIMIT 1
        """,
        (exam_id, student_id),
    ).fetchone()
    return int(row["page_number"]) if row else None


def _other_certificate_page(
    conn: Any, exam_id: str, student_id: str, page_id: str
) -> int | None:
    """ผู้เข้าสอบคนนี้มีเกียรติบัตรในรายการสอบนี้จาก "หน้าอื่น" อยู่แล้วหรือไม่

    เช็ค staging_page_id ด้วย เพื่อให้รันจับคู่ซ้ำรอบเดิมได้โดยไม่ถือว่าชนกับตัวเอง
    """
    row = conn.execute(
        """
        SELECT sp.page_number
        FROM certificates c JOIN staging_pages sp ON sp.id = c.staging_page_id
        WHERE c.exam_id = %s AND c.student_id = %s AND c.staging_page_id <> %s
        LIMIT 1
        """,
        (exam_id, student_id, page_id),
    ).fetchone()
    return int(row["page_number"]) if row else None


def _fill_missing_fields(
    conn: Any,
    student_id: str,
    row: RosterRow,
    name_th_norm: str | None,
    name_en_norm: str | None,
    school_norm: str | None,
) -> None:
    """เติมข้อมูลที่เดิมยังว่างอยู่ (Excel คนละรอบอาจมีคนละภาษา หรือเพิ่งเริ่มมีคอลัมน์โรงเรียน)"""
    conn.execute(
        """
        UPDATE students
        SET name_th = COALESCE(name_th, %s),
            name_en = COALESCE(name_en, %s),
            name_th_normalized = COALESCE(name_th_normalized, %s),
            name_en_normalized = COALESCE(name_en_normalized, %s),
            name_en_sort_key = COALESCE(name_en_sort_key, %s),
            school = COALESCE(school, %s),
            school_normalized = COALESCE(school_normalized, %s)
        WHERE id = %s
        """,
        (
            row.name_th or None,
            row.name_en or None,
            name_th_norm,
            name_en_norm,
            name_sort_key(row.name_en) or None,
            row.school or None,
            school_norm,
            student_id,
        ),
    )


def _create_student(
    conn: Any,
    row: RosterRow,
    name_th_norm: str | None,
    name_en_norm: str | None,
    school_norm: str | None,
) -> str:
    student_id = new_id()
    conn.execute(
        """
        INSERT INTO students
          (id, name_th, name_en, name_th_normalized, name_en_normalized, name_en_sort_key,
           school, school_normalized)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            student_id,
            row.name_th or None,
            row.name_en or None,
            name_th_norm,
            name_en_norm,
            name_sort_key(row.name_en) or None,
            row.school or None,
            school_norm,
        ),
    )
    return student_id


def _mark_duplicate_name(page_id: str, conflict_page: int | None, row: RosterRow) -> None:
    """ยกให้แอดมินตัดสิน พร้อมเก็บข้อมูลจากแถว Excel ติดไปด้วย

    เก็บรางวัลกับโรงเรียนไว้เพราะตอนนี้ยังรู้อยู่ ถ้าไม่เก็บ แอดมินต้องเปิด Excel
    มาไล่หาแล้วพิมพ์ใหม่เองตอนตัดสิน ซึ่งเสี่ยงพิมพ์ผิดและเสียเวลาโดยไม่จำเป็น
    """
    where = f"หน้า {conflict_page}" if conflict_page else "หน้าอื่น"
    note = (
        f"ชื่อนี้ซ้ำกับ{where}ที่จับคู่ไปแล้วในรายการสอบเดียวกัน "
        "กรุณาเทียบเกียรติบัตรทั้งสองใบแล้วเลือกว่าเป็นคนละคน หรือเป็นใบซ้ำ"
    )
    with connection() as conn:
        conn.execute(
            """
            UPDATE staging_pages
            SET match_status = 'DUPLICATE_NAME', match_note = %s,
                pending_award = %s, pending_school = %s
            WHERE id = %s AND match_status <> 'MATCHED'
            """,
            (note, row.award or None, row.school or None, page_id),
        )


def _mark_ambiguous(page_id: str, note: str) -> None:
    with connection() as conn:
        conn.execute(
            """
            UPDATE staging_pages
            SET match_status = 'AMBIGUOUS', match_note = %s
            WHERE id = %s AND match_status <> 'MATCHED'
            """,
            (note, page_id),
        )


def _load_batch(batch_id: str) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT b.id, b.exam_id, b.source_excel_key, p.code AS exam_code, p.kind
            FROM batches b
            JOIN exams e ON e.id = b.exam_id
            JOIN exam_programs p ON p.id = e.program_id
            WHERE b.id = %s
            """,
            (batch_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"ไม่พบ batch {batch_id}")
    return row


def _load_pages(batch_id: str) -> list[dict[str, Any]]:
    with connection() as conn:
        return conn.execute(
            """
            SELECT id, page_number, pdf_key, preview_key, cert_no, level,
                   extracted_name_normalized, extracted_name_sort_key
            FROM staging_pages
            WHERE batch_id = %s AND match_status NOT IN ('SKIPPED_FOREIGN', 'DISCARDED')
            ORDER BY page_number
            """,
            (batch_id,),
        ).fetchall()


def _count_unmatched_pages(batch_id: str) -> int:
    with connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM staging_pages
            WHERE batch_id = %s AND match_status IN ('UNMATCHED', 'AMBIGUOUS', 'DUPLICATE_NAME')
            """,
            (batch_id,),
        ).fetchone()
    return int(row["n"])
