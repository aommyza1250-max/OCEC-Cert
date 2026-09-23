"""สร้างไฟล์รายชื่อ Excel จากไฟล์เกียรติบัตร สำหรับตอนที่ต้นทางไม่ได้ส่งชีทรายชื่อมาให้

    docker compose exec worker python scripts/roster_from_certificates.py tmp/HKIMO --program HKIMO --round FINAL
    docker compose exec worker python scripts/roster_from_certificates.py tmp/bundle.zip --program HKIMO --round HEAT -o tmp/roster.xlsx
    docker compose exec worker python scripts/roster_from_certificates.py tmp/HKIMO --program HKIMO --round FINAL --mode ONSITE

รับได้ทั้งโฟลเดอร์และไฟล์ ZIP — ถ้าเส้นทางมีโฟลเดอร์ online/onsite จะอ่านรูปแบบการสอบจากตรงนั้น
ไม่มีก็ใช้ค่าจาก --mode (ปริยาย ONLINE)
ได้ไฟล์ .xlsx หัวตารางเหมือนของจริง: CANDIDATE NO / GRADE / CANDIDATE NAME / AWARD / EXAM MODE / SCHOOL

⚠️ ไฟล์ที่ได้ **ไม่ใช่ข้อมูลจากต้นทาง** แต่เป็นสิ่งที่อ่านได้จากหน้าเกียรติบัตรเอง
   ใช้ทดสอบระบบได้ดี แต่จับผิด "เกียรติบัตรไม่ตรงกับรายชื่อ" ไม่ได้ เพราะมันมาจากที่เดียวกัน
   ของจริงตอนใช้งานต้องใช้ชีทจากต้นทางเสมอ

⚠️ ไฟล์ที่ได้มีชื่อผู้เข้าสอบจริง ห้าม commit ขึ้น git (มี *.xlsx ใน .gitignore อยู่แล้ว)
"""

import argparse
import sys
import zipfile
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf  # noqa: E402
from openpyxl import Workbook  # noqa: E402

from app.certificate_profiles import AwardCatalog, Nationality, folder_key, get_profile  # noqa: E402
from app.normalize import normalize_name  # noqa: E402
from app.tasks.extract import page_text  # noqa: E402

HEADERS = ["CANDIDATE NO", "GRADE", "CANDIDATE NAME", "AWARD", "EXAM MODE", "SCHOOL"]
MODES = ("ONLINE", "ONSITE")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="โฟลเดอร์ที่แยกรางวัลไว้ หรือไฟล์ .zip")
    parser.add_argument("--program", required=True, help="รหัสรายการสอบ เช่น HKIMO")
    parser.add_argument("--round", required=True, choices=("HEAT", "FINAL"))
    parser.add_argument("--mode", default="ONLINE", choices=MODES,
                        help="รูปแบบการสอบของไฟล์ที่ไม่ได้อยู่ในโฟลเดอร์ online/onsite")
    parser.add_argument("-o", "--out", help="ไฟล์ .xlsx ที่จะเขียน (ปริยาย: ข้าง ๆ ไฟล์ต้นทาง)")
    parser.add_argument("--include-foreign", action="store_true",
                        help="ใส่ผู้เข้าสอบต่างชาติด้วย (ปริยายเอาเฉพาะไทย เหมือนชีทของจริง)")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"ไม่พบ {source}")
        return 1
    profile = get_profile(args.program, args.round)
    catalog = profile.catalog

    rows: dict[str, dict] = {}
    skipped_foreign = 0
    unreadable: list[str] = []
    conflicts: list[str] = []
    multi_award: set[str] = set()
    pages = 0

    for text, award, mode, where in _read_pages(source, catalog, args.mode):
        pages += 1
        parsed = profile.parse(text)
        if not args.include_foreign and profile.nationality(parsed) is Nationality.FOREIGN:
            skipped_foreign += 1
            continue
        if not parsed.candidate_no or not parsed.name:
            unreadable.append(f"{where} (เลข {parsed.candidate_no or '-'} ชื่อ {parsed.name or '-'})")
            continue

        existing = rows.get(parsed.candidate_no)
        if existing is None:
            rows[parsed.candidate_no] = {
                "name": parsed.name, "level": parsed.level or "", "award": award, "mode": mode,
                "school": parsed.school_on_page or "",
            }
            continue
        # เลขเดียวกันแต่คนละชื่อ = ไฟล์ต้นทางมีปัญหา ต้องบอกให้รู้ ห้ามเงียบ
        if normalize_name(existing["name"]) != normalize_name(parsed.name):
            conflicts.append(f"เลข {parsed.candidate_no}: {existing['name']} / {parsed.name} ({where})")
            continue
        # คนเดิมอีกใบ — เก็บรางวัลที่สูงกว่า ให้เหมือนชีทของจริงที่มีคนละแถวเดียว
        multi_award.add(f"{parsed.name} ({parsed.candidate_no})")
        if _rank(catalog, award) < _rank(catalog, existing["award"]):
            existing["award"] = award

    if not pages:
        print("ไม่พบหน้าเกียรติบัตรเลย")
        return 1

    out = Path(args.out) if args.out else source.with_suffix("").with_name(
        f"{source.with_suffix('').name}-roster.xlsx"
    )
    _write(out, rows, catalog)

    print(f"อ่านหน้าเกียรติบัตร {pages} หน้า ด้วยโปรไฟล์ {profile.key}")
    if skipped_foreign:
        print(f"  ข้ามผู้เข้าสอบต่างชาติ {skipped_foreign} หน้า (ใส่ --include-foreign ถ้าต้องการ)")
    if multi_award:
        print(f"  คนที่ได้หลายใบ {len(multi_award)} คน เขียนลงชีทคนละแถวตามรางวัลสูงสุด")
    for label, items in (("อ่านไม่ครบ", unreadable), ("เลขซ้ำแต่ชื่อไม่ตรงกัน", conflicts)):
        if items:
            print(f"  ⚠️ {label} {len(items)} หน้า ไม่ได้ใส่ลงชีท:")
            for item in items[:10]:
                print(f"      {item}")
    modes: dict[str, int] = {}
    for row in rows.values():
        modes[row["mode"]] = modes.get(row["mode"], 0) + 1
    print(f"เขียน {len(rows)} แถว -> {out}  ({modes})")
    return 0


def _rank(catalog: AwardCatalog, code: str) -> int:
    """ลำดับความสูงของรางวัลในชีท — ชีทของจริงเขียน PERFECT SCORER ให้คนที่ได้ทั้งทองและคะแนนเต็ม"""
    if code == "PERFECT_SCORE":
        return -1
    award = catalog.get(code)
    return award.order if award else 999


def _read_pages(source: Path, catalog: AwardCatalog, default_mode: str):
    """คืน (ข้อความ, รหัสรางวัล, รูปแบบการสอบ, ที่มา) ของทุกหน้า — เปิดทีละไฟล์"""
    if source.is_file() and zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as zf:
            for name in sorted(zf.namelist()):
                if not name.lower().endswith(".pdf") or "__MACOSX" in name:
                    continue
                located = _locate(PurePosixPath(name).parts[:-1], catalog, default_mode)
                if not located:
                    print(f"  ⚠️ ข้าม {name} — ไม่รู้ว่าอยู่ในโฟลเดอร์รางวัลอะไร")
                    continue
                with pymupdf.open(stream=zf.read(name), filetype="pdf") as doc:
                    yield from _pages_of(doc, *located, name)
        return

    if not source.is_dir():
        raise SystemExit(f"{source} ไม่ใช่โฟลเดอร์และไม่ใช่ไฟล์ zip")
    for pdf in sorted(source.rglob("*.pdf")):
        located = _locate(pdf.relative_to(source).parts[:-1], catalog, default_mode)
        if not located:
            print(f"  ⚠️ ข้าม {pdf.relative_to(source)} — ไม่รู้ว่าอยู่ในโฟลเดอร์รางวัลอะไร")
            continue
        with pymupdf.open(pdf) as doc:
            yield from _pages_of(doc, *located, str(pdf.relative_to(source)))


def _locate(dirs: tuple[str, ...], catalog: AwardCatalog, default_mode: str) -> tuple[str, str] | None:
    """เครื่องมือนี้ใช้กับโฟลเดอร์ที่จัดมาหลายแบบ จึงไล่หาจากชั้นใกล้ไฟล์ขึ้นไป
    (ต่างจากการนำเข้าจริง ซึ่งอ่านเฉพาะตำแหน่งที่กำหนดเท่านั้น)"""
    mode = next((folder_key(d) for d in dirs if folder_key(d) in MODES), default_mode)
    for folder in reversed(dirs):
        award = catalog.resolve_folder(folder)
        if award:
            return award.code, mode
    return None


def _pages_of(doc, award: str, mode: str, where: str):
    for index in range(doc.page_count):
        yield page_text(doc[index]), award, mode, f"{where} หน้า {index + 1}"


def _write(out: Path, rows: dict[str, dict], catalog: AwardCatalog) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Roster"
    sheet.append(HEADERS)
    # เรียงตามเลขผู้เข้าสอบ ให้ไล่ตรวจด้วยตาได้ง่าย
    for cert_no in sorted(rows, key=lambda n: (len(n), n)):
        row = rows[cert_no]
        sheet.append([cert_no, row["level"], row["name"], _award_text(catalog, row["award"]),
                      row["mode"], row["school"]])
    for column, width in zip(sheet.column_dimensions, [16, 26, 34, 18, 12, 40]):
        sheet.column_dimensions[column].width = width
    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(out)


def _award_text(catalog: AwardCatalog, code: str) -> str:
    """ข้อความรางวัลแบบที่ชีทของจริงเขียน"""
    if code == "PERFECT_SCORE":
        return "PERFECT SCORER"
    award = catalog.get(code)
    return f"{(award.label if award else code).upper()} AWARD"


if __name__ == "__main__":
    raise SystemExit(main())
