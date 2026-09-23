"""จับคู่หน้าเกียรติบัตรกับรายชื่อที่ใช้อยู่ แล้วออกเกียรติบัตร

ลำดับการตรวจของแต่ละหน้า (ตามสเปก):
  1. หาผู้เข้าสอบในรายชื่อด้วยเลขบนหน้า (Cert No = เลขผู้เข้าสอบ ไม่ซ้ำกันทั้ง online/onsite)
  2. ยืนยันด้วยชื่อ — เลขตรงแต่ชื่อไม่ตรง = NAME_MISMATCH
  3. เทียบรูปแบบการสอบจากโฟลเดอร์ใน ZIP กับรายชื่อ — ไม่ตรง = MODE_MISMATCH
  4. รางวัลมาจากโฟลเดอร์ (หรือที่แอดมินเปลี่ยนเอง) — คนเดียวรางวัลเดียวกันซ้ำไม่ได้
  5. ผ่านหมดจึงออกเกียรติบัตร

อ่านเลขไม่ได้เท่านั้นจึงลองจับด้วยชื่อ + รูปแบบการสอบ และต้องตรงคนเดียวพอดี
เลขอ่านได้แต่ไม่มีในรายชื่อ = UNMATCHED ไม่ถอยไปใช้ชื่อ (น่าจะเป็นคนที่ตกหล่นจากรายชื่อ
ให้แอดมินเพิ่มเข้ามา แล้วหน้านี้จะจับคู่เองในรอบถัดไป)

**รันซ้ำได้เสมอ** — ทุกครั้งคำนวณผลใหม่ทั้งรอบจากข้อมูลหน้า + รายชื่อ + การตัดสินของแอดมิน
แล้วเขียนเฉพาะส่วนที่เปลี่ยน ใบที่ผลเหมือนเดิมไม่ถูกลบสร้างใหม่ (วันหมดอายุเดิมจึงไม่รีเซ็ต)
การตัดสินของแอดมินเก็บอยู่บนหน้าและบนรายชื่อ ไม่หายเมื่อจับคู่ใหม่ — เว้นแต่รายชื่อเปลี่ยน
จนการตัดสินนั้นไม่ตรงกับความจริงแล้ว ซึ่งจะกลับไปให้ตรวจใหม่ ไม่เชื่อต่อเงียบ ๆ

หลักการสำคัญ: **ถ้าไม่มั่นใจ ห้ามเดา** ดีกว่าจับคู่ผิดแล้วผู้ปกครองโหลดได้เกียรติบัตรของคนอื่น
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable

from ..certificate_profiles import AwardCatalog, FromField, get_profile
from ..db import connection, new_id
from ..normalize import name_sort_key, normalize_name, normalize_school

log = logging.getLogger(__name__)

ProgressFn = Callable[[dict[str, Any]], None]

# สถานะที่ตัวจับคู่คำนวณใหม่ได้ทุกรอบ
# ที่เหลือ (ทิ้งแล้ว, ถูกแทน, ต่างชาติ, รอยืนยันสัญชาติ, รอตรวจรอบ/ปี) เป็นผลของการตัดหน้า
# หรือการตัดสินของแอดมิน ตัวจับคู่ไม่แตะ — แอดมินยืนยันแล้วหน้านั้นจะถูกตั้งกลับเป็น UNMATCHED เอง
EVALUABLE = ("UNMATCHED", "MATCHED", "NAME_MISMATCH", "MODE_MISMATCH", "AMBIGUOUS", "DUPLICATE_NAME")


@dataclass(frozen=True)
class Entry:
    id: str
    candidate_no: str
    names: frozenset[str]
    exam_mode: str
    school: str | None = None
    school_normalized: str | None = None
    level: str | None = None
    raw_award: str | None = None
    student_id: str | None = None
    name_en: str | None = None
    name_th: str | None = None


@dataclass(frozen=True)
class Page:
    id: str
    page_number: int
    cert_no: str | None
    name_normalized: str | None
    exam_mode: str | None
    award: str
    fingerprint: str | None = None
    manual_match: dict[str, Any] | None = None
    mode_confirmed_for: str | None = None
    school_on_page: str | None = None
    level: str | None = None


@dataclass
class Decision:
    status: str
    entry_id: str | None = None
    how: str | None = None
    note: str | None = None
    review: dict[str, Any] = field(default_factory=dict)
    # False = การผูกด้วยมือเดิมใช้ไม่ได้แล้ว (รายชื่อเปลี่ยน) ต้องล้างทิ้ง
    keep_manual: bool = True


# ---------------------------------------------------------------- ตัดสินใจ (ฟังก์ชันล้วน)


def manual_snapshot(entry: Entry) -> dict[str, Any]:
    """ค่าที่ใช้ยืนยันว่าการผูกด้วยมือยังใช้ได้ — ถ้าค่าใดเปลี่ยน ต้องกลับไปตรวจใหม่"""
    return {
        "rosterEntryId": entry.id,
        "candidateNo": entry.candidate_no,
        "names": sorted(entry.names),
        "examMode": entry.exam_mode,
    }


def decide(
    pages: list[Page], entries: list[Entry], school_is_on_page: bool = False
) -> dict[str, Decision]:
    """ตัดสินทุกหน้าพร้อมกัน — ไม่แตะฐานข้อมูล จึงทดสอบได้ตรง ๆ

    หน้าที่แอดมินผูกด้วยมือไว้ได้สิทธิ์ก่อน จากนั้นไล่ตามลำดับหน้า
    หน้าที่นำเข้าก่อนจึงเป็นใบหลักเสมอ ใบที่มาทีหลังและชนกันจะถูกส่งให้แอดมินดู
    """
    by_id = {e.id: e for e in entries}
    by_no = {e.candidate_no: e for e in entries}
    by_name_mode: dict[tuple[str, str], list[Entry]] = defaultdict(list)
    for entry in entries:
        for name in entry.names:
            by_name_mode[(name, entry.exam_mode)].append(entry)

    issued: dict[tuple[str, str], Page] = {}
    accepted_content: dict[tuple[str, str], str] = {}
    decisions: dict[str, Decision] = {}

    ordered = sorted(pages, key=lambda p: (0 if p.manual_match else 1, p.page_number))
    for page in ordered:
        decision = _decide_one(page, by_id, by_no, by_name_mode)
        if decision.status == "MATCHED":
            decision = _check_duplicates(page, decision, issued, accepted_content, by_id)
        if decision.status == "MATCHED":
            entry = by_id[decision.entry_id]
            issued[(entry.id, page.award)] = page
            if page.fingerprint:
                accepted_content[(entry.id, page.fingerprint)] = page.award
            warnings = _cross_check(page, entry, school_is_on_page)
            if warnings:
                decision.review["warnings"] = warnings
        decisions[page.id] = decision
    return decisions


def _decide_one(
    page: Page,
    by_id: dict[str, Entry],
    by_no: dict[str, Entry],
    by_name_mode: dict[tuple[str, str], list[Entry]],
) -> Decision:
    entry: Entry | None = None
    how: str | None = None
    keep_manual = True
    note_prefix = ""

    if page.manual_match:
        linked = by_id.get(page.manual_match.get("rosterEntryId"))
        if linked and manual_snapshot(linked) == _comparable(page.manual_match):
            entry, how = linked, "manual"
        else:
            keep_manual = False
            note_prefix = "รายชื่อเปลี่ยนไปหลังจากที่จับคู่หน้านี้ด้วยมือ จึงต้องตรวจใหม่ — "

    if entry is None and page.cert_no:
        entry = by_no.get(page.cert_no)
        how = "number"
        if entry is None:
            return Decision(
                "UNMATCHED", keep_manual=keep_manual,
                note=note_prefix + f"เลข {page.cert_no} ไม่มีในรายชื่อ — ถ้าเป็นผู้เข้าสอบที่ตกหล่น "
                "ให้เพิ่มเข้ารายชื่อ แล้วหน้านี้จะจับคู่เอง",
            )

    if entry is None:
        if not page.name_normalized:
            return Decision("UNMATCHED", keep_manual=keep_manual,
                            note=note_prefix + "อ่านทั้งเลขและชื่อจากหน้านี้ไม่ได้ — ต้องจับคู่ด้วยมือ")
        candidates = by_name_mode.get((page.name_normalized, page.exam_mode or ""), [])
        if len(candidates) > 1:
            return Decision(
                "AMBIGUOUS", keep_manual=keep_manual,
                note=note_prefix + f"หน้านี้อ่านเลขไม่ได้ และชื่อตรงกับผู้เข้าสอบ {len(candidates)} คน "
                "ในรูปแบบการสอบเดียวกัน — ระบบไม่เลือกให้",
                review={"candidateEntryIds": sorted(c.id for c in candidates)},
            )
        if not candidates:
            return Decision(
                "UNMATCHED", keep_manual=keep_manual,
                note=note_prefix + "หน้านี้อ่านเลขไม่ได้ และไม่พบชื่อนี้ในรายชื่อ (รูปแบบการสอบเดียวกัน)",
            )
        entry, how = candidates[0], "name"

    # เลขตรงแต่ชื่อไม่ตรง — กันเลขชนกันโดยบังเอิญ หรือไฟล์ผิดคน
    # หน้าที่อ่านชื่อไม่ออกเลยให้เชื่อเลข ดีกว่าทิ้งใบนั้นไปเฉย ๆ
    if how == "number" and page.name_normalized and page.name_normalized not in entry.names:
        return Decision(
            "NAME_MISMATCH", entry.id, how, keep_manual=keep_manual,
            note=note_prefix + f"เลข {page.cert_no} ตรงกับรายชื่อ แต่ชื่อบนหน้าไม่ตรงกับชื่อในรายชื่อ",
        )

    mode_ok = page.exam_mode == entry.exam_mode or page.mode_confirmed_for == entry.exam_mode
    if not mode_ok:
        return Decision(
            "MODE_MISMATCH", entry.id, how, keep_manual=keep_manual,
            note=note_prefix + f"ไฟล์อยู่ในโฟลเดอร์ {_mode_text(page.exam_mode)} "
            f"แต่รายชื่อระบุว่าสอบแบบ {_mode_text(entry.exam_mode)}",
        )

    note = None if keep_manual else "จับคู่ใหม่อัตโนมัติ — การจับคู่ด้วยมือเดิมใช้ไม่ได้แล้วเพราะรายชื่อเปลี่ยน"
    return Decision("MATCHED", entry.id, how, keep_manual=keep_manual, note=note)


def _check_duplicates(
    page: Page,
    decision: Decision,
    issued: dict[tuple[str, str], Page],
    accepted_content: dict[tuple[str, str], str],
    by_id: dict[str, Entry],
) -> Decision:
    entry = by_id[decision.entry_id]
    if page.fingerprint:
        other_award = accepted_content.get((entry.id, page.fingerprint))
        if other_award and other_award != page.award:
            return Decision(
                "DUPLICATE_NAME", entry.id, decision.how, keep_manual=decision.keep_manual,
                note=f"หน้านี้เนื้อหาเดียวกับใบรางวัล {other_award} ที่รับไปแล้ว — ถ้าจะเปลี่ยนรางวัล "
                "ให้ใช้ปุ่มเปลี่ยนรางวัลที่ใบเดิม",
            )
    holder = issued.get((entry.id, page.award))
    if holder:
        return Decision(
            "DUPLICATE_NAME", entry.id, decision.how, keep_manual=decision.keep_manual,
            note=f"ผู้เข้าสอบเลข {entry.candidate_no} มีใบรางวัล {page.award} แล้วจากหน้า {holder.page_number} "
            "— ต้องดูว่าเป็นใบซ้ำ หรือรางวัลผิดโฟลเดอร์",
            review={"acceptedPageId": holder.id},
        )
    return decision


def _cross_check(page: Page, entry: Entry, school_is_on_page: bool) -> list[str]:
    """ข้อที่ควรตรงกันแต่ไม่ถึงกับทำให้จับคู่ไม่ได้ — แสดงให้แอดมินเห็นเท่านั้น"""
    warnings: list[str] = []
    # รอบ Heat พิมพ์โรงเรียนไว้บนหน้า แต่โรงเรียนในรายชื่อเป็นค่าหลักเสมอ
    if school_is_on_page and page.school_on_page and entry.school_normalized:
        if normalize_school(page.school_on_page) != entry.school_normalized:
            warnings.append(
                f"โรงเรียนบนเกียรติบัตร ({page.school_on_page}) ไม่ตรงกับรายชื่อ ({entry.school})"
            )
    if page.level and entry.level and page.level.strip().upper() != entry.level.strip().upper():
        warnings.append(f"ระดับชั้นบนเกียรติบัตร ({page.level}) ไม่ตรงกับรายชื่อ ({entry.level})")
    return warnings


def _comparable(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "rosterEntryId": snapshot.get("rosterEntryId"),
        "candidateNo": snapshot.get("candidateNo"),
        "names": sorted(snapshot.get("names") or []),
        "examMode": snapshot.get("examMode"),
    }


def _mode_text(mode: str | None) -> str:
    return {"ONLINE": "online", "ONSITE": "onsite"}.get(mode or "", "ไม่ระบุ")


# ---------------------------------------------------------------- ระบุตัวคน (ฟังก์ชันล้วน)


@dataclass(frozen=True)
class StudentRow:
    id: str
    name_en_normalized: str | None
    name_th_normalized: str | None
    school_normalized: str | None


@dataclass(frozen=True)
class Identity:
    """ผลการระบุตัวคนของผู้เข้าสอบ 1 คน"""

    kind: str  # LINK | NEW | AMBIGUOUS
    student_id: str | None = None
    candidates: tuple[str, ...] = ()


def resolve_identities(
    targets: list[Entry], batch_entries: list[Entry], students: list[StudentRow]
) -> dict[str, Identity]:
    """หาว่าผู้เข้าสอบแต่ละคนในรายชื่อคือใครใน students (ตัวคนที่ใช้ซ้ำข้ามปี)

    กติกา:
      - ผู้เข้าสอบ 2 คนในรอบเดียวกันเป็นคนละคนเสมอ (เลขไม่ซ้ำกัน) จึงห้ามผูกกับตัวคนเดียวกัน
      - ชื่อตรงกับตัวคนเดิมคนเดียวพอดี และไม่มีผู้เข้าสอบชื่อเดียวกันในรอบนี้มาแย่ง = ผูก
      - ไม่มีใครชื่อนี้เลย = สร้างคนใหม่ (ไม่ใช่การเดา เพราะไม่มีใครให้สับสน)
      - นอกนั้น **ห้ามสร้างคนใหม่** ส่งให้แอดมินเลือก เพราะการสร้างคนใหม่ก็เป็นการเดาอย่างหนึ่ง
        และถ้าจับคู่ซ้ำหลายรอบจะเกิดตัวคนซ้ำซ้อนขึ้นเรื่อย ๆ โดยไม่มีอะไรฟ้อง
    """
    taken = {e.student_id for e in batch_entries if e.student_id}
    by_name: dict[str, list[StudentRow]] = defaultdict(list)
    for s in students:
        for name in {s.name_en_normalized, s.name_th_normalized} - {None}:
            by_name[name].append(s)

    claims: dict[str, list[StudentRow]] = {}
    for entry in targets:
        seen: dict[str, StudentRow] = {}
        for name in entry.names:
            for s in by_name.get(name, []):
                if s.id not in taken:
                    seen[s.id] = s
        claims[entry.id] = _narrow_by_school(list(seen.values()), entry.school_normalized)

    result: dict[str, Identity] = {}
    for entry in targets:
        candidates = claims[entry.id]
        if not candidates:
            result[entry.id] = Identity("NEW")
            continue
        ids = tuple(sorted(c.id for c in candidates))
        if len(candidates) > 1:
            result[entry.id] = Identity("AMBIGUOUS", candidates=ids)
            continue
        student = candidates[0]
        rivals = [o for o in targets if o.id != entry.id and any(c.id == student.id for c in claims[o.id])]
        result[entry.id] = Identity("AMBIGUOUS", candidates=ids) if rivals else Identity("LINK", student.id)
    return result


def _narrow_by_school(candidates: list[StudentRow], school_norm: str | None) -> list[StudentRow]:
    """คัดตัวคนชื่อพ้องให้เหลือเฉพาะคนที่อยู่โรงเรียนเดียวกัน

    - เจอคนโรงเรียนเดียวกัน -> เอาเฉพาะกลุ่มนั้น
    - ไม่เจอ แต่มีคนที่ยังไม่เคยบันทึกโรงเรียน -> ถือว่าน่าจะใช่ แล้วค่อยเติมโรงเรียนให้
    - ทุกคนที่ชื่อนี้อยู่คนละโรงเรียน -> เป็นคนใหม่แน่นอน
    """
    if not school_norm or not candidates:
        return candidates
    same_school = [c for c in candidates if c.school_normalized == school_norm]
    if same_school:
        return same_school
    return [c for c in candidates if not c.school_normalized]


# ---------------------------------------------------------------- งานของ worker


def run_match(batch_id: str, on_progress: ProgressFn, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """จับคู่ใหม่ทั้งรอบนำเข้า แล้วเขียนผลในทรานแซกชันเดียว"""
    with connection() as conn:
        with conn.transaction():
            batch = conn.execute(
                """
                SELECT b.id, b.exam_id, b.status::text AS status, p.code AS program_code,
                       e.round::text AS round, e.year, b.active_roster_import_id
                FROM batches b JOIN exams e ON e.id = b.exam_id JOIN exam_programs p ON p.id = e.program_id
                WHERE b.id = %s FOR UPDATE OF b
                """,
                (batch_id,),
            ).fetchone()
            if batch is None:
                raise ValueError(f"ไม่พบ batch {batch_id}")
            if batch["status"] == "PUBLISHED":
                raise ValueError("รอบนี้เผยแพร่อยู่ ต้องยกเลิกการเผยแพร่ก่อนจึงจะจับคู่ใหม่ได้")

            profile = get_profile(batch["program_code"], batch["round"])
            entries = _load_entries(conn, batch_id)
            pages, current = _load_pages(conn, batch_id)
            on_progress({"stage": "match", "done": 0, "total": len(pages)})

            decisions = decide(pages, list(entries.values()), profile.from_field is FromField.SCHOOL)
            stats = _apply(conn, batch, profile.catalog, entries, pages, current, decisions)

    on_progress({"stage": "match", "done": len(pages), "total": len(pages)})
    log.info("จับคู่ batch %s เสร็จ: %s", batch_id, stats)
    return stats


def _load_entries(conn: Any, batch_id: str) -> dict[str, Entry]:
    rows = conn.execute(
        """
        SELECT id::text, candidate_no, name_en, name_th, name_en_normalized, name_th_normalized,
               exam_mode::text AS exam_mode, school, school_normalized, level, raw_award,
               student_id::text
        FROM roster_entries WHERE batch_id = %s
        """,
        (batch_id,),
    ).fetchall()
    return {
        r["id"]: Entry(
            id=r["id"], candidate_no=r["candidate_no"],
            names=frozenset(n for n in (r["name_en_normalized"], r["name_th_normalized"]) if n),
            exam_mode=r["exam_mode"], school=r["school"], school_normalized=r["school_normalized"],
            level=r["level"], raw_award=r["raw_award"], student_id=r["student_id"],
            name_en=r["name_en"], name_th=r["name_th"],
        )
        for r in rows
    }


def _load_pages(conn: Any, batch_id: str) -> tuple[list[Page], dict[str, dict[str, Any]]]:
    rows = conn.execute(
        """
        SELECT id::text, page_number, cert_no, extracted_name_normalized, exam_mode::text AS exam_mode,
               COALESCE(award_override, award) AS award, fingerprint, manual_match,
               mode_confirmed_for::text AS mode_confirmed_for, school_on_page, level,
               match_status::text AS match_status, roster_entry_id::text, matched_student_id::text,
               match_note, review, matched_manually, roster_award, pdf_key, preview_key
        FROM staging_pages
        WHERE batch_id = %s AND match_status::text = ANY(%s)
          AND exam_mode IS NOT NULL AND award IS NOT NULL
        ORDER BY page_number
        """,
        (batch_id, list(EVALUABLE)),
    ).fetchall()
    pages = [
        Page(
            id=r["id"], page_number=r["page_number"], cert_no=r["cert_no"],
            name_normalized=r["extracted_name_normalized"], exam_mode=r["exam_mode"],
            award=r["award"], fingerprint=r["fingerprint"], manual_match=r["manual_match"],
            mode_confirmed_for=r["mode_confirmed_for"], school_on_page=r["school_on_page"],
            level=r["level"],
        )
        for r in rows
    ]
    return pages, {r["id"]: r for r in rows}


def _apply(
    conn: Any,
    batch: dict[str, Any],
    catalog: AwardCatalog,
    entries: dict[str, Entry],
    pages: list[Page],
    current: dict[str, dict[str, Any]],
    decisions: dict[str, Decision],
) -> dict[str, Any]:
    stats: dict[str, Any] = defaultdict(int)

    # 1. ระบุตัวคนของผู้เข้าสอบที่มีใบผ่านแล้วแต่ยังไม่ได้ผูกตัวคน
    needing = {d.entry_id for d in decisions.values() if d.status == "MATCHED"}
    targets = [entries[i] for i in sorted(needing) if not entries[i].student_id]
    student_of = {e.id: e.student_id for e in entries.values() if e.student_id}
    if targets:
        identities = resolve_identities(targets, list(entries.values()), _load_students(conn, targets))
        for entry in targets:
            identity = identities[entry.id]
            if identity.kind == "AMBIGUOUS":
                stats["identityAmbiguous"] += 1
                for page_id, decision in decisions.items():
                    if decision.entry_id == entry.id and decision.status == "MATCHED":
                        decisions[page_id] = Decision(
                            "AMBIGUOUS", entry.id, decision.how, keep_manual=decision.keep_manual,
                            note="มีผู้เข้าสอบชื่อนี้อยู่ในระบบแล้ว และข้อมูลที่มีแยกไม่ออกว่าเป็นคนไหน "
                            "— เลือกที่หน้าแก้ไขผู้เข้าสอบ ว่าเป็นคนเดิมคนไหน หรือเป็นคนใหม่",
                            review={"identity": True, "studentCandidateIds": list(identity.candidates)},
                        )
                continue
            if identity.kind == "LINK":
                student_of[entry.id] = identity.student_id
                _fill_missing_fields(conn, identity.student_id, entry)
                stats["studentsLinked"] += 1
            else:
                student_of[entry.id] = _create_student(conn, entry)
                stats["studentsCreated"] += 1
            conn.execute(
                "UPDATE roster_entries SET student_id = %s, updated_at = NOW() WHERE id = %s",
                (student_of[entry.id], entry.id),
            )

    # 2. เขียนผลของแต่ละหน้า เฉพาะหน้าที่ผลเปลี่ยน
    for page in pages:
        decision = decisions[page.id]
        stats[f"status:{decision.status}"] += 1
        if decision.status == "MATCHED":
            stats[f"matchedBy:{decision.how}"] += 1
        if decision.review.get("warnings"):
            stats["crossCheckWarnings"] += 1
        before = current[page.id]
        entry = entries.get(decision.entry_id) if decision.entry_id else None
        student_id = student_of.get(decision.entry_id) if decision.status == "MATCHED" else None
        manual_match = before["manual_match"] if decision.keep_manual else None
        if not decision.keep_manual:
            stats["manualInvalidated"] += 1
        after = {
            "match_status": decision.status,
            "roster_entry_id": decision.entry_id,
            "matched_student_id": student_id,
            "match_note": decision.note,
            "review": decision.review,
            "matched_manually": bool(manual_match),
            "roster_award": entry.raw_award if entry else before["roster_award"],
        }
        if any(before[k] != v for k, v in after.items()) or manual_match != before["manual_match"]:
            conn.execute(
                """
                UPDATE staging_pages
                SET match_status = %s, roster_entry_id = %s, matched_student_id = %s, match_note = %s,
                    review = %s, matched_manually = %s, roster_award = %s, manual_match = %s
                WHERE id = %s
                """,
                (
                    after["match_status"], after["roster_entry_id"], after["matched_student_id"],
                    after["match_note"], json.dumps(after["review"], ensure_ascii=False),
                    after["matched_manually"], after["roster_award"],
                    json.dumps(manual_match, ensure_ascii=False) if manual_match else None, page.id,
                ),
            )
            stats["pagesChanged"] += 1

    # 3. เกียรติบัตร: คำนวณชุดที่ควรมี แล้วเทียบกับที่มีอยู่
    _sync_certificates(conn, batch, catalog, entries, current, decisions, student_of, stats)
    return _flatten(stats, len(pages))


def _sync_certificates(
    conn: Any,
    batch: dict[str, Any],
    catalog: AwardCatalog,
    entries: dict[str, Entry],
    current: dict[str, dict[str, Any]],
    decisions: dict[str, Decision],
    student_of: dict[str, str | None],
    stats: dict[str, Any],
) -> None:
    desired: dict[str, dict[str, Any]] = {}
    for page_id, decision in decisions.items():
        if decision.status != "MATCHED":
            continue
        page = current[page_id]
        entry = entries[decision.entry_id]
        award = catalog.get(page["award"])
        desired[page_id] = {
            "student_id": student_of[entry.id],
            "roster_entry_id": entry.id,
            "award": page["award"],
            "award_label": award.label if award else page["award"],
            "award_label_th": award.label_th if award else None,
            "pdf_key": page["pdf_key"],
            "preview_key": page["preview_key"],
            "page_number": current[page_id]["page_number"],
            "cert_no": page["cert_no"],
            "candidate_no": entry.candidate_no,
            # ระดับชั้นบนหน้ากระดาษก่อน เพราะนั่นคือสิ่งที่ผู้ปกครองถืออยู่ในมือ
            "level": page["level"] or entry.level,
        }

    existing = conn.execute(
        """
        SELECT c.id::text, c.staging_page_id::text, c.roster_entry_id::text, c.student_id::text,
               c.award, c.award_label, c.award_label_th, c.pdf_key, c.preview_key, c.page_number,
               c.cert_no, c.candidate_no, c.level, c.expires_at, re.candidate_no AS entry_no
        FROM certificates c LEFT JOIN roster_entries re ON re.id = c.roster_entry_id
        WHERE c.batch_id = %s
        """,
        (batch["id"],),
    ).fetchall()

    identity_keys = ("roster_entry_id", "student_id", "award")
    keep: dict[str, dict[str, Any]] = {}
    carried: dict[tuple[str, str], Any] = {}
    doomed: list[str] = []
    for cert in existing:
        want = desired.get(cert["staging_page_id"])
        if want and all(cert[k] == want[k] for k in identity_keys):
            keep[cert["staging_page_id"]] = cert
            continue
        # ใบถูกแทนด้วยหน้าอื่นของคนเดิม รางวัลเดิม — ส่งวันหมดอายุต่อ ไม่รีเซ็ตนาฬิกาเงียบ ๆ
        if cert["expires_at"] and cert["entry_no"]:
            carried[(cert["entry_no"], cert["award"])] = cert["expires_at"]
        doomed.append(cert["id"])

    if doomed:
        conn.execute("DELETE FROM certificates WHERE id = ANY(%s)", (doomed,))
        stats["certificatesRemoved"] += len(doomed)

    display = ("award_label", "award_label_th", "pdf_key", "preview_key", "page_number",
               "cert_no", "candidate_no", "level")
    for page_id, cert in keep.items():
        want = desired[page_id]
        if any(cert[k] != want[k] for k in display):
            conn.execute(
                """
                UPDATE certificates
                SET award_label = %s, award_label_th = %s, pdf_key = %s, preview_key = %s,
                    page_number = %s, cert_no = %s, candidate_no = %s, level = %s
                WHERE id = %s
                """,
                (*(want[k] for k in display), cert["id"]),
            )
            stats["certificatesUpdated"] += 1

    for page_id, want in desired.items():
        if page_id in keep:
            continue
        conn.execute(
            """
            INSERT INTO certificates
              (id, student_id, exam_id, batch_id, staging_page_id, roster_entry_id, pdf_key,
               preview_key, page_number, award, award_label, award_label_th, cert_no, candidate_no,
               level, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                new_id(), want["student_id"], batch["exam_id"], batch["id"], page_id,
                want["roster_entry_id"], want["pdf_key"], want["preview_key"], want["page_number"],
                want["award"], want["award_label"], want["award_label_th"], want["cert_no"],
                want["candidate_no"], want["level"],
                carried.get((want["candidate_no"], want["award"])),
            ),
        )
        stats["certificatesCreated"] += 1
    stats["certificates"] = len(desired)


def _load_students(conn: Any, targets: list[Entry]) -> list[StudentRow]:
    names = sorted({n for e in targets for n in e.names})
    if not names:
        return []
    rows = conn.execute(
        """
        SELECT id::text, name_en_normalized, name_th_normalized, school_normalized FROM students
        WHERE name_en_normalized = ANY(%s) OR name_th_normalized = ANY(%s)
        ORDER BY created_at
        """,
        (names, names),
    ).fetchall()
    return [StudentRow(**r) for r in rows]


def _create_student(conn: Any, entry: Entry) -> str:
    student_id = new_id()
    conn.execute(
        """
        INSERT INTO students
          (id, name_th, name_en, name_th_normalized, name_en_normalized, name_en_sort_key,
           school, school_normalized)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            student_id, entry.name_th, entry.name_en,
            _normalized(entry.name_th), _normalized(entry.name_en),
            name_sort_key(entry.name_en or "") or None, entry.school, entry.school_normalized,
        ),
    )
    return student_id


def _fill_missing_fields(conn: Any, student_id: str, entry: Entry) -> None:
    """เติมข้อมูลที่ตัวคนเดิมยังว่างอยู่ (ปีก่อนอาจมีแค่ชื่ออังกฤษ หรือยังไม่มีโรงเรียน)"""
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
            entry.name_th, entry.name_en, _normalized(entry.name_th), _normalized(entry.name_en),
            name_sort_key(entry.name_en or "") or None, entry.school, entry.school_normalized,
            student_id,
        ),
    )


def _normalized(name: str | None) -> str | None:
    return normalize_name(name or "") or None


def _flatten(stats: dict[str, Any], evaluated: int) -> dict[str, Any]:
    by_status = {k.split(":", 1)[1]: v for k, v in stats.items() if k.startswith("status:")}
    by_how = {k.split(":", 1)[1]: v for k, v in stats.items() if k.startswith("matchedBy:")}
    plain = {k: v for k, v in stats.items() if ":" not in k}
    return {
        "pagesEvaluated": evaluated,
        "matched": by_status.get("MATCHED", 0),
        "matchedByNumber": by_how.get("number", 0),
        "matchedByName": by_how.get("name", 0),
        "matchedManually": by_how.get("manual", 0),
        "nameMismatch": by_status.get("NAME_MISMATCH", 0),
        "modeMismatch": by_status.get("MODE_MISMATCH", 0),
        "ambiguous": by_status.get("AMBIGUOUS", 0),
        "duplicates": by_status.get("DUPLICATE_NAME", 0),
        "unmatched": by_status.get("UNMATCHED", 0),
        **plain,
    }
