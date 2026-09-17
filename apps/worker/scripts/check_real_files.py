"""ตรวจตัวอ่านเกียรติบัตรกับ "ไฟล์จริง" ที่วางไว้ใน apps/worker/tmp/

รันในคอนเทนเนอร์:
    docker compose exec worker python scripts/check_real_files.py

สคริปต์นี้ไม่แตะฐานข้อมูลและไม่อัปโหลดอะไร แค่อ่านไฟล์แล้วรายงานว่า
สกัดข้อมูลได้ครบแค่ไหน และตรงกับไฟล์ Excel หรือไม่

ไฟล์จริงมีข้อมูลส่วนบุคคล จึง **ไม่ถูก commit เข้า git** (tmp/ อยู่ใน .gitignore)
ถ้าไม่มีไฟล์ สคริปต์จะบอกแล้วจบอย่างสงบ ไม่ถือว่าล้มเหลว
"""

import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

from app.normalize import normalize_award, normalize_name  # noqa: E402
from app.storage import certificate_stem  # noqa: E402
from app.tasks.extract import page_lines, page_text, read_lines  # noqa: E402
from app.tasks.zip_bundle import Bundle  # noqa: E402

TMP = Path("/app/tmp")


def main() -> int:
    pdf_dirs = [p for p in TMP.iterdir() if p.is_dir()] if TMP.exists() else []
    xlsx = sorted(TMP.glob("*.xlsx")) if TMP.exists() else []

    if not pdf_dirs and not xlsx:
        print(f"ไม่พบไฟล์จริงใน {TMP} — ข้ามการตรวจ (ปกติ ไฟล์จริงไม่ได้อยู่ใน git)")
        return 0

    bundles = _collect(pdf_dirs)
    if not bundles:
        print("ไม่พบไฟล์ PDF ในโฟลเดอร์ย่อย")
        return 1

    pages = _read_pages(bundles)
    ok = _report_extraction(pages)
    if xlsx:
        ok = _report_roster(pages, xlsx[0]) and ok

    print()
    print("ผ่านทั้งหมด ✓" if ok else "มีข้อที่ไม่ผ่าน ✗")
    return 0 if ok else 1


def _collect(pdf_dirs: list[Path]) -> list[Bundle]:
    """เก็บ PDF ทุกไฟล์พร้อมรางวัลจากชื่อโฟลเดอร์ที่มันอยู่ (เหมือนที่ทำกับ ZIP)"""
    bundles = []
    for root in pdf_dirs:
        for path in sorted(root.rglob("*.pdf")):
            award = normalize_award(path.parent.name)
            if not award:
                print(f"  ! โฟลเดอร์ '{path.parent.name}' แปลงเป็นรางวัลไม่ได้")
                continue
            bundles.append(Bundle(award=award, source_file=str(path), data=path.read_bytes()))
    return bundles


def _read_pages(bundles: list[Bundle]) -> list[dict]:
    pages = []
    for bundle in bundles:
        with pymupdf.open(stream=bundle.data, filetype="pdf") as doc:
            for i in range(doc.page_count):
                info = read_lines(page_lines(page_text(doc[i])))
                pages.append({"award": bundle.award, "page": i + 1, "info": info,
                              "file": Path(bundle.source_file).parent.name})
    return pages


def _report_extraction(pages: list[dict]) -> bool:
    total = len(pages)
    print("=" * 72)
    print(f"ตรวจการสกัดข้อมูลจากหน้าเกียรติบัตร ({total} หน้า)")
    print("=" * 72)

    checks = {
        "อ่านชื่อได้": sum(1 for p in pages if p["info"].name),
        "อ่านเลขผู้เข้าสอบได้": sum(1 for p in pages if p["info"].cert_no),
        "อ่านระดับชั้นได้": sum(1 for p in pages if p["info"].level),
        "อ่านปีได้": sum(1 for p in pages if p["info"].year),
        "อ่านรอบได้": sum(1 for p in pages if p["info"].round_on_page),
        "อ่านสัญชาติได้": sum(1 for p in pages if p["info"].country),
    }
    ok = True
    for label, count in checks.items():
        mark = "✓" if count == total else "✗"
        if count != total:
            ok = False
        print(f"  {mark} {label}: {count}/{total}")

    by_award = collections.Counter(p["award"] for p in pages)
    print(f"  · รางวัลจากโฟลเดอร์: {dict(by_award)}")

    with_line = [p for p in pages if p["info"].award_on_page]
    mismatched = [p for p in with_line if normalize_award(p["info"].award_on_page) != p["award"]]
    print(f"  {'✓' if not mismatched else '✗'} รางวัลบนหน้าตรงกับโฟลเดอร์: "
          f"{len(with_line) - len(mismatched)}/{len(with_line)} "
          f"(อีก {total - len(with_line)} หน้าไม่มีบรรทัดรางวัล ซึ่งเป็นปกติของ Perfect Score)")
    if mismatched:
        ok = False

    certs = [p["info"].cert_no for p in pages if p["info"].cert_no]
    dup = len(certs) - len(set(certs))
    print(f"  · เลขผู้เข้าสอบไม่ซ้ำ {len(set(certs))} เลข จาก {len(certs)} หน้า "
          f"({dup} หน้าใช้เลขซ้ำกับหน้าอื่น = คนเดียวได้หลายใบ)")

    print()
    print("  ตัวอย่างชื่อไฟล์ที่จะได้:")
    for p in pages[:3]:
        stem = certificate_stem(
            normalize_name(p["info"].name or ""), "HKIMO",
            p["info"].round_on_page or "FINAL", p["award"],
            p["info"].year or 0, p["page"],
        )
        print(f"    {stem}.pdf")
    return ok


def _report_roster(pages: list[dict], xlsx_path: Path) -> bool:
    print()
    print("=" * 72)
    print(f"เทียบกับไฟล์ Excel: {xlsx_path.name}")
    print("=" * 72)

    wb = load_workbook(xlsx_path, read_only=True, data_only=True)
    rows = [r for r in wb[wb.sheetnames[0]].iter_rows(values_only=True)][1:]
    rows = [r for r in rows if r and r[0] is not None]
    roster = {str(r[0]).strip(): {"name": str(r[2]).strip(), "award": str(r[3]).strip(),
                                  "level": str(r[1]).strip()} for r in rows}
    print(f"  แถวใน Excel: {len(rows)} | เลขไม่ซ้ำ: {len(roster)}")

    matched = name_ok = level_ok = 0
    misses = []
    for p in pages:
        cert = p["info"].cert_no
        row = roster.get(cert)
        if not row:
            misses.append((cert, p["info"].name))
            continue
        matched += 1
        if normalize_name(row["name"]) == normalize_name(p["info"].name or ""):
            name_ok += 1
        if (row["level"] or "").upper() == (p["info"].level or "").upper():
            level_ok += 1

    total = len(pages)
    ok = matched == total and name_ok == matched
    print(f"  {'✓' if matched == total else '✗'} หน้าที่หาเลขเจอใน Excel: {matched}/{total}")
    print(f"  {'✓' if name_ok == matched else '✗'} เลขตรงและชื่อตรงด้วย: {name_ok}/{matched}")
    print(f"  {'✓' if level_ok == matched else '·'} ระดับชั้นตรงกัน: {level_ok}/{matched}")
    for cert, name in misses[:5]:
        print(f"    ! ไม่เจอเลข {cert} ({name}) ใน Excel")

    used = {p["info"].cert_no for p in pages}
    unused = [c for c in roster if c not in used]
    print(f"  {'✓' if not unused else '!'} แถว Excel ที่ไม่มีหน้าเกียรติบัตร: {len(unused)}")
    return ok


if __name__ == "__main__":
    raise SystemExit(main())
