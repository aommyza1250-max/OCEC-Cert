"""เทสการอ่านโครงสร้าง ZIP ที่แอดมินอัปโหลด

รางวัลอ่านจากชื่อโฟลเดอร์ ซึ่งเป็นแหล่งเดียวที่รู้รางวัลได้ครบ
(หน้า Perfect Score ของจริงไม่มีข้อความรางวัลพิมพ์อยู่บนหน้าเลย)
"""

import pytest

from app.tasks.zip_bundle import ZipLayoutError, read_award_bundles
from tests.fixtures.builders import make_award_zip, make_bundle_pdf

PDF = make_bundle_pdf([{"name": "SOMCHAI JAIDEE", "cert_no": "1", "award": "Gold"}])


def test_อ่านรางวัลจากชื่อโฟลเดอร์():
    data = make_award_zip({"Gold": PDF, "Silver": PDF, "Perfect_Score": PDF})
    bundles = read_award_bundles(data)
    assert sorted(b.award for b in bundles) == ["GOLD", "PERFECT_SCORE", "SILVER"]


def test_รองรับโฟลเดอร์ครอบชั้นนอก():
    # ซิปโฟลเดอร์บนเครื่องมักได้ชั้นครอบติดมาด้วย เช่น HKIMO/Gold/x.pdf
    data = make_award_zip({}, extra_files={"HKIMO/Gold/a.pdf": PDF, "HKIMO/Merit/b.pdf": PDF})
    bundles = read_award_bundles(data)
    assert sorted(b.award for b in bundles) == ["GOLD", "MERIT"]


def test_ชื่อโฟลเดอร์เขียนได้หลายแบบ():
    data = make_award_zip({}, extra_files={
        "gold/a.pdf": PDF,
        "perfect score/b.pdf": PDF,
        "BRONZE/c.pdf": PDF,
    })
    assert sorted(b.award for b in read_award_bundles(data)) == ["BRONZE", "GOLD", "PERFECT_SCORE"]


def test_ข้ามขยะจาก_macOS_และไฟล์ที่ไม่ใช่_PDF():
    data = make_award_zip({"Gold": PDF}, extra_files={
        "__MACOSX/Gold/._a.pdf": b"junk",
        "Gold/.DS_Store": b"junk",
        "Gold/readme.txt": b"junk",
    })
    bundles = read_award_bundles(data)
    assert len(bundles) == 1
    assert bundles[0].award == "GOLD"


def test_โฟลเดอร์ที่ไม่รู้จักต้องหยุดงาน_ไม่ใช่เดา():
    data = make_award_zip({}, extra_files={"Participation/a.pdf": PDF})
    with pytest.raises(ZipLayoutError, match="Participation"):
        read_award_bundles(data)


def test_PDF_วางนอกโฟลเดอร์ต้องหยุดงาน():
    data = make_award_zip({}, extra_files={"a.pdf": PDF})
    with pytest.raises(ZipLayoutError, match="นอกโฟลเดอร์"):
        read_award_bundles(data)


def test_ZIP_ที่ไม่มี_PDF_เลย():
    data = make_award_zip({}, extra_files={"readme.txt": b"hi"})
    with pytest.raises(ZipLayoutError, match="ไม่พบไฟล์ PDF"):
        read_award_bundles(data)


def test_เก็บชื่อไฟล์ต้นทางไว้ไล่ย้อนได้():
    data = make_award_zip({}, extra_files={"HKIMO/Gold/THAILAND_Gold_Award.pdf": PDF})
    assert read_award_bundles(data)[0].source_file == "HKIMO/Gold/THAILAND_Gold_Award.pdf"
