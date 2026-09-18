"""สร้างไฟล์รายชื่อ Excel จากไฟล์เกียรติบัตร สำหรับตอนที่ต้นทางไม่ได้ส่งชีทรายชื่อมาให้

    docker compose exec worker python scripts/roster_from_certificates.py tmp/HKIMO
    docker compose exec worker python scripts/roster_from_certificates.py tmp/bundle.zip -o tmp/roster.xlsx
    docker compose exec worker python scripts/roster_from_certificates.py tmp/HKIMO --include-foreign

รับได้ทั้งโฟลเดอร์ที่แยกรางวัลไว้แล้ว และไฟล์ ZIP แบบเดียวกับที่อัปเข้าระบบ
ได้ไฟล์ .xlsx หัวตารางเหมือนของจริง: CANDIDATE NO / GRADE / CANDIDATE NAME / AWARD

⚠️ ไฟล์ที่ได้ **ไม่ใช่ข้อมูลจากต้นทาง** แต่เป็นสิ่งที่อ่านได้จากหน้าเกียรติบัตรเอง
   ใช้ทดสอบระบบได้ดี แต่จับผิด "เกียรติบัตรไม่ตรงกับรายชื่อ" ไม่ได้ เพราะมันมาจากที่เดียวกัน
   ของจริงตอนใช้งานต้องใช้ชีทจากต้นทางเสมอ

⚠️ ไฟล์ที่ได้มีชื่อผู้เข้าสอบจริง ห้าม commit ขึ้น git (มี *.xlsx ใน .gitignore อยู่แล้ว)
"""

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf  # noqa: E402
from openpyxl import Workbook  # noqa: E402

from app.normalize import normalize_award, normalize_name  # noqa: E402
from app.tasks.extract import is_thai_national, page_lines, page_text, read_lines  # noqa: E402
from app.tasks.zip_bundle import open_bundles, read_award_bundles  # noqa: E402

HEADERS = ["CANDIDATE NO", "GRADE", "CANDIDATE NAME", "AWARD"]

# ข้อความรางวัลแบบที่ชีทของจริงเขียน
AWARD_TEXT = {
    "GOLD": "GOLD AWARD",
    "SILVER": "SILVER AWARD",
    "BRONZE": "BRONZE AWARD",
    "MERIT": "MERIT AWARD",
    "PERFECT_SCORE": "PERFECT SCORER",
}

# ชีทของจริงมีคนละแถวเดียว และเขียนรางวัลสูงสุดไว้
# คนที่ได้ทั้งเหรียญทองและคะแนนเต็ม ในชีทจะเป็น "PERFECT SCORER"
AWARD_RANK = ["PERFECT_SCORE", "GOLD", "SILVER", "BRONZE", "MERIT"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="โฟลเดอร์ที่แยกรางวัลไว้ หรือไฟล์ .zip")
    parser.add_argument("-o", "--out", help="ไฟล์ .xlsx ที่จะเขียน (ปริยาย: ข้าง ๆ ไฟล์ต้นทาง)")
    parser.add_argument("--include-foreign", action="store_true",
                        help="ใส่ผู้เข้าสอบต่างชาติด้วย (ปริยายเอาเฉพาะไทย เหมือนชีทของจริง)")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"ไม่พบ {source}")
        return 1

    pages = list(_read_pages(source))
    if not pages:
        print("ไม่พบหน้าเกียรติบัตรเลย")
        return 1

    rows: dict[str, dict] = {}
    skipped_foreign = 0
    unreadable: list[str] = []
    multi_award: list[str] = []
    conflicts: list[str] = []

    for info, award, text, where in pages:
        if not args.include_foreign and not is_thai_national(text, ""):
            skipped_foreign += 1
            continue
        if not info.cert_no or not info.name:
            unreadable.append(f"{where} (เลข {info.cert_no or '-'} ชื่อ {info.name or '-'})")
            continue

        existing = rows.get(info.cert_no)
        if existing is None:
            rows[info.cert_no] = {"name": info.name, "level": info.level or "", "award": award}
            continue

        # เลขเดียวกันแต่คนละชื่อ = ไฟล์ต้นทางมีปัญหา ต้องบอกให้รู้ ห้ามเงียบ
        # เก็บชื่อแรกที่เจอไว้ก่อน แล้วรายงานให้ไปแก้ไฟล์ต้นทาง
        # (ถ้าทิ้งทั้งคู่ คนที่ข้อมูลถูกต้องจะหายไปจากชีทด้วย ซึ่งแย่กว่า)
        if normalize_name(existing["name"]) != normalize_name(info.name):
            conflicts.append(f"เลข {info.cert_no}: {existing['name']} / {info.name} ({where})")
            continue

        # คนเดิมอีกใบ — เก็บรางวัลที่สูงกว่าไว้ ให้เหมือนชีทของจริงที่มีคนละแถวเดียว
        multi_award.append(f"{info.name} ({info.cert_no})")
        if _rank(award) < _rank(existing["award"]):
            existing["award"] = award

    out = Path(args.out) if args.out else source.with_suffix("").with_name(
        f"{source.with_suffix('').name}-roster.xlsx"
    )
    _write(out, rows)

    print(f"อ่านหน้าเกียรติบัตร {len(pages)} หน้า")
    if skipped_foreign:
        print(f"  ข้ามผู้เข้าสอบต่างชาติ {skipped_foreign} หน้า (ใส่ --include-foreign ถ้าต้องการ)")
    if multi_award:
        shown = ", ".join(sorted(set(multi_award))[:3])
        print(f"  คนที่ได้หลายใบ {len(set(multi_award))} คน เขียนลงชีทคนละแถวตามรางวัลสูงสุด: {shown}")
    if unreadable:
        print(f"  ⚠️ อ่านไม่ครบ {len(unreadable)} หน้า ไม่ได้ใส่ลงชีท:")
        for item in unreadable[:10]:
            print(f"      {item}")
    if conflicts:
        print(f"  ⚠️ เลขผู้เข้าสอบซ้ำแต่ชื่อไม่ตรงกัน {len(conflicts)} หน้า — ไฟล์ต้นทางมีปัญหา:")
        for item in conflicts[:10]:
            print(f"      {item}")

    awards: dict[str, int] = {}
    for row in rows.values():
        awards[row["award"]] = awards.get(row["award"], 0) + 1
    print(f"เขียน {len(rows)} แถว -> {out}")
    print(f"  รางวัล: {dict(sorted(awards.items()))}")
    if unreadable or conflicts:
        print("\nหน้าที่มีปัญหาไม่ได้ถูกใส่ลงชีท ต้องแก้ไฟล์ต้นทางหรือเติมแถวเอง")
        print("ไม่งั้นตอนนำเข้าจะมีคนจับคู่ไม่ได้")
    return 0


def _rank(award: str) -> int:
    return AWARD_RANK.index(award) if award in AWARD_RANK else len(AWARD_RANK)


def _read_pages(source: Path):
    """คืน (info, award, raw_text, ที่มา) ของทุกหน้า"""
    if source.is_file() and zipfile.is_zipfile(source):
        bundles = read_award_bundles(str(source))
        with open_bundles(str(source), bundles) as stream:
            for bundle in stream:
                with pymupdf.open(stream=bundle.data, filetype="pdf") as doc:
                    yield from _pages_of(doc, bundle.award, bundle.source_file)
        return

    if not source.is_dir():
        raise SystemExit(f"{source} ไม่ใช่โฟลเดอร์และไม่ใช่ไฟล์ zip")

    for pdf in sorted(source.rglob("*.pdf")):
        award = _award_from_path(pdf, source)
        if not award:
            print(f"  ⚠️ ข้าม {pdf.relative_to(source)} — ไม่รู้ว่าอยู่ในโฟลเดอร์รางวัลอะไร")
            continue
        with pymupdf.open(pdf) as doc:
            yield from _pages_of(doc, award, str(pdf.relative_to(source)))


def _award_from_path(pdf: Path, root: Path) -> str:
    """ไล่หาชื่อโฟลเดอร์ที่แปลงเป็นรางวัลได้ ตั้งแต่โฟลเดอร์ที่ใกล้ไฟล์ที่สุดขึ้นไป"""
    for parent in pdf.relative_to(root).parents:
        if parent.name and (award := normalize_award(parent.name)):
            return award
    return ""


def _pages_of(doc, award: str, where: str):
    for index in range(doc.page_count):
        text = page_text(doc[index])
        yield read_lines(page_lines(text)), award, text, f"{where} หน้า {index + 1}"


def _write(out: Path, rows: dict[str, dict]) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Roster"
    sheet.append(HEADERS)

    # เรียงตามเลขผู้เข้าสอบ ให้ไล่ตรวจด้วยตาได้ง่าย
    for cert_no in sorted(rows, key=lambda n: (len(n), n)):
        row = rows[cert_no]
        sheet.append([cert_no, row["level"], row["name"],
                      AWARD_TEXT.get(row["award"], row["award"])])

    widths = [16, 26, 34, 18]
    for column, width in zip(sheet.column_dimensions, widths):
        sheet.column_dimensions[column].width = width

    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(out)


if __name__ == "__main__":
    raise SystemExit(main())
