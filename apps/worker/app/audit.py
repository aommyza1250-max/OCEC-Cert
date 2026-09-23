"""บันทึกการแก้ไขของแอดมินลง audit_events (ฝั่ง worker)

งานบางอย่างแอดมินสั่งจากหน้าเว็บ แต่ worker เป็นคนลงมือ (สลับรายชื่อ เปลี่ยนไฟล์เกียรติบัตร)
เว็บจึงส่งรหัส session มากับงาน แล้ว worker บันทึกในทรานแซกชันเดียวกับการแก้ไขจริง
— ถ้าบันทึกแยกทีหลัง แล้วงานพังตรงกลาง จะได้ร่องรอยของสิ่งที่ไม่ได้เกิดขึ้นจริง

ระบบใช้รหัสผ่านร่วมกัน จึงเก็บได้แค่รหัส session ห้ามเขียนราวกับรู้ว่าใครทำ
"""

import json
from typing import Any

from .db import new_id


def record_audit(
    conn: Any,
    *,
    batch_id: str | None,
    batch_label: str | None,
    entity_type: str,
    entity_id: str | None,
    action: str,
    session_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO audit_events
          (id, batch_id, batch_label, entity_type, entity_id, action, before, after, session_id, note)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            new_id(), batch_id, batch_label, entity_type, entity_id, action,
            json.dumps(before, ensure_ascii=False, default=str) if before is not None else None,
            json.dumps(after, ensure_ascii=False, default=str) if after is not None else None,
            session_id, note,
        ),
    )
