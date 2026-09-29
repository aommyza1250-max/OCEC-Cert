"""ตัวช่วยของสคริปต์ทดสอบ — สร้างรอบนำเข้าสมมติผ่านขั้นตอนจริง แล้วล้างทิ้งเมื่อจบ

ขั้นตอนเหมือนที่แอดมินทำ: สร้างรอบ -> อัปรายชื่อ -> ใช้รายชื่อ -> อัป ZIP -> จับคู่

ต้องใช้รหัสรายการที่มีโปรไฟล์จริง (ไม่มีโปรไฟล์กลางให้ถอยไปใช้) จึงสร้างรอบนำเข้าใต้รายการ
HKIMO ด้วย "ปี" ที่ไม่มีใครใช้ (2090 ขึ้นไป) แทนการตั้งรหัสรายการใหม่
ตอนล้างจะลบเฉพาะรอบ/ปีที่สคริปต์สร้างเอง **ไม่ลบรายการสอบที่มีอยู่แล้ว** เด็ดขาด
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import connection, new_id  # noqa: E402
from app.storage import delete_keys, list_keys, upload_bytes  # noqa: E402
from app.tasks.match import run_match  # noqa: E402
from app.tasks.roster import run_roster_activate, run_roster_validate  # noqa: E402
from app.tasks.split import run_split  # noqa: E402
from tests.fixtures.builders import make_roster_xlsx, make_zip  # noqa: E402

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PROGRAM = "HKIMO"


def noop(_progress: dict[str, Any]) -> None:
    pass


@dataclass
class TestBatch:
    batch_id: str
    exam_id: str
    program_id: str
    year: int
    round: str
    created_program: bool


def create_batch(exam_round: str = "FINAL", program: str = PROGRAM) -> TestBatch:
    with connection() as conn:
        existing = conn.execute("SELECT id FROM exam_programs WHERE code = %s", (program,)).fetchone()
        program_id = existing["id"] if existing else new_id()
        if not existing:
            conn.execute(
                "INSERT INTO exam_programs (id, code, name, updated_at) VALUES (%s, %s, %s, NOW())",
                (program_id, program, f"[ทดสอบ] {program}"),
            )
        used = {
            r["year"] for r in conn.execute(
                "SELECT year FROM exams WHERE program_id = %s AND round = %s AND year >= 2090",
                (program_id, exam_round),
            )
        }
        year = next(y for y in range(2090, 2100) if y not in used)
        exam_id, batch_id = new_id(), new_id()
        conn.execute(
            "INSERT INTO exams (id, program_id, round, year) VALUES (%s, %s, %s, %s)",
            (exam_id, program_id, exam_round, year),
        )
        conn.execute(
            """
            INSERT INTO batches (id, exam_id, status, profile_key, note, updated_at)
            VALUES (%s, %s, 'DRAFT', %s, 'สร้างโดยสคริปต์ทดสอบ', NOW())
            """,
            (batch_id, exam_id, f"{program}_{exam_round}"),
        )
    return TestBatch(batch_id, exam_id, str(program_id), year, exam_round, not existing)


def make_job(batch_id: str, job_type: str, payload: dict[str, Any]) -> str:
    """แถวงานให้หน้าที่สร้างขึ้นอ้างถึง — สคริปต์เรียกตัวงานเองตรง ๆ ไม่ผ่านคิว

    ตั้งเป็น DONE ตั้งแต่แรก ถ้าตั้งเป็น RUNNING แล้ว worker รีสตาร์ทพอดี (dev ใช้ --reload)
    worker จะเอางานนี้กลับเข้าคิวแล้วทำซ้ำพร้อมกับสคริปต์ ผลจะมั่วจนดูเหมือนระบบพัง
    """
    job_id = new_id()
    with connection() as conn:
        conn.execute(
            """
            INSERT INTO jobs (id, type, batch_id, payload, status, finished_at)
            VALUES (%s, %s, %s, %s, 'DONE', NOW())
            """,
            (job_id, job_type, batch_id, json.dumps(payload)),
        )
    return job_id


def use_roster(batch_id: str, people: list[dict[str, Any]], school: bool = False) -> str:
    """ร่างรายชื่อ -> ตรวจ -> ใช้ -> จับคู่ใหม่ ในจังหวะเดียว

    people: dict ที่มี name, cert_no, level, award และ mode (ปริยาย ONLINE)
    """
    headers = {"cert_no": "CANDIDATE NO", "level": "GRADE", "name_en": "CANDIDATE NAME",
               "award": "AWARD", "mode": "EXAM MODE"}
    if school:
        headers["school"] = "SCHOOL"
    rows = [{"cert_no": p["cert_no"], "level": p.get("level", ""), "name_en": p["name"],
             "award": p.get("award", ""), "mode": p.get("mode", "ONLINE"), "school": p.get("school", "")}
            for p in people]
    key = f"sources/{batch_id}/roster-{new_id()}.xlsx"
    upload_bytes(key, make_roster_xlsx(rows, headers=headers), XLSX_MIME)
    import_id = new_id()
    with connection() as conn:
        conn.execute(
            "INSERT INTO roster_imports (id, batch_id, source_key) VALUES (%s, %s, %s)",
            (import_id, batch_id, key),
        )
    run_roster_validate(batch_id, noop, {"importId": import_id})
    with connection() as conn:
        status = conn.execute("SELECT status::text AS s, errors FROM roster_imports WHERE id = %s",
                              (import_id,)).fetchone()
        if status["s"] != "READY":
            raise RuntimeError(f"รายชื่อทดสอบไม่ผ่านการตรวจ: {status['errors']}")
        conn.execute("UPDATE roster_imports SET status = 'ACTIVATING' WHERE id = %s", (import_id,))
    run_roster_activate(batch_id, noop, {"importId": import_id, "sessionId": "script"})
    run_match(batch_id, noop)
    return import_id


def upload_zip(batch_id: str, files: dict[str, bytes]) -> dict[str, Any]:
    key = f"sources/{batch_id}/bundle-{new_id()}.zip"
    upload_bytes(key, make_zip(files), "application/zip")
    payload = {"kind": "zip", "zipKey": key, "fileName": "test.zip"}
    stats = run_split(batch_id, make_job(batch_id, "SPLIT", payload), noop, payload)
    with connection() as conn:
        conn.execute("UPDATE batches SET source_zip_key = %s WHERE id = %s", (key, batch_id))
    return stats


def cleanup(batches: list[TestBatch], student_suffix: str) -> None:
    """ลบเฉพาะสิ่งที่สคริปต์สร้าง — รอบนำเข้า ปีทดสอบ ไฟล์ และตัวคนที่ชื่อลงท้ายด้วยคำที่กำหนด"""
    for b in batches:
        for prefix in ("certificates", "previews", "sources"):
            delete_keys([k["key"] for k in list_keys(f"{prefix}/{b.batch_id}/")])
    with connection() as conn:
        for b in batches:
            conn.execute("DELETE FROM batches WHERE id = %s", (b.batch_id,))
            conn.execute("DELETE FROM exams WHERE id = %s", (b.exam_id,))
            if b.created_program:
                conn.execute(
                    "DELETE FROM exam_programs p WHERE p.id = %s AND NOT EXISTS "
                    "(SELECT 1 FROM exams e WHERE e.program_id = p.id)",
                    (b.program_id,),
                )
        conn.execute(
            """
            DELETE FROM students s WHERE s.name_en LIKE %s
              AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.student_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM roster_entries r WHERE r.student_id = s.id)
            """,
            (f"%{student_suffix}",),
        )
        conn.execute("DELETE FROM deleted_batches WHERE program_code = %s AND year >= 2090", (PROGRAM,))
    print("\n(ล้างข้อมูลทดสอบเรียบร้อย)")
