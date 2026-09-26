"""เทสการตรวจโครงสร้าง ZIP ก่อนนำเข้า

รางวัลอ่านจากโฟลเดอร์ในตำแหน่งที่กำหนด (ถัดจาก online/onsite) ส่วนรูปแบบการสอบอ่านจาก
โฟลเดอร์ online/onsite — ผิดข้อเดียวต้องปฏิเสธทั้ง ZIP ก่อนแตะข้อมูลอะไรเลย
"""

import pytest

from app.certificate_profiles import get_profile
from app.tasks.zip_bundle import ZipLayoutError, preflight_zip
from tests.fixtures.builders import make_bundle_pdf, make_zip

FINAL = get_profile("HKIMO", "FINAL")
HEAT = get_profile("HKIMO", "HEAT")
PDF = make_bundle_pdf([{"name": "SOMCHAI JAIDEE", "cert_no": "1", "award": "Gold", "country": "THAILAND"}])
PDF2 = make_bundle_pdf([
    {"name": "SOMCHAI JAIDEE", "cert_no": "1", "country": "THAILAND"},
    {"name": "MALEE RUNGROJ", "cert_no": "2", "country": "THAILAND"},
])
HEAT_PDF = make_bundle_pdf([{"name": "SOMCHAI JAIDEE", "cert_no": "1", "school": "A SCHOOL", "round": "Heat"}])


def problems(files: dict, profile=FINAL, year=2026) -> dict:
    with pytest.raises(ZipLayoutError) as err:
        preflight_zip(make_zip(files), profile, year)
    return err.value.report["problems"]


def test_ZIP_รวม_online_และ_onsite():
    report = preflight_zip(make_zip({"online/Gold/a.pdf": PDF, "onsite/Silver/b.pdf": PDF2}), FINAL, 2026)
    assert sorted((b.mode, b.award) for b in report.bundles) == [("ONLINE", "GOLD"), ("ONSITE", "SILVER")]
    summary = report.to_dict()
    assert summary["modes"] == {"ONLINE": {"files": 1, "pages": 1}, "ONSITE": {"files": 1, "pages": 2}}
    assert summary["pages"] == 3
    assert summary["byModeAward"] == {"ONLINE": {"GOLD": 1}, "ONSITE": {"SILVER": 2}}


def test_ZIP_ที่มีแค่_online_หรือแค่_onsite():
    assert [b.mode for b in preflight_zip(make_zip({"online/Gold/a.pdf": PDF}), FINAL, 2026).bundles] == ["ONLINE"]
    assert [b.mode for b in preflight_zip(make_zip({"ONSITE/gold/a.pdf": PDF}), FINAL, 2026).bundles] == ["ONSITE"]


def test_มีโฟลเดอร์ครอบชั้นนอกหนึ่งชั้นได้():
    report = preflight_zip(make_zip({"HKIMO/online/Gold/a.pdf": PDF, "HKIMO/onsite/Merit/b.pdf": PDF}), FINAL, 2026)
    assert report.wrapper == "HKIMO"
    assert len(report.bundles) == 2


def test_โฟลเดอร์ครอบหลายชื่อต้องปฏิเสธ():
    found = problems({"A/online/Gold/a.pdf": PDF, "B/onsite/Gold/b.pdf": PDF})
    assert "many_wrappers" in found


def test_ครอบลึกเกินหนึ่งชั้นต้องปฏิเสธ():
    assert "too_deep_wrapper" in problems({"A/B/online/Gold/a.pdf": PDF})


def test_แยกตามรางวัลอย่างเดียวรับได้_และรายงานว่าต้องใช้โหมดจากรายชื่อ():
    report = preflight_zip(make_zip({"Gold/a.pdf": PDF, "Silver/b.pdf": PDF2}), FINAL, 2026)
    assert report.layout == "AWARD_ONLY"
    assert report.to_dict()["modes"] == {}
    assert [(b.mode, b.award) for b in report.bundles] == [(None, "GOLD"), (None, "SILVER")]


def test_แยกตามรางวัลมีโฟลเดอร์ครอบได้():
    report = preflight_zip(make_zip({"BBB/Gold/a.pdf": PDF, "BBB/Silver/b.pdf": PDF2}), FINAL, 2026)
    assert report.wrapper == "BBB"
    assert report.layout == "AWARD_ONLY"


def test_ปนโครงแยกโหมดกับแยกรางวัลใน_zip_เดียวกันต้องปฏิเสธ():
    assert "mixed_layout" in problems({"Gold/a.pdf": PDF, "online/Silver/b.pdf": PDF2})


def test_โฟลเดอร์รางวัลที่ไม่รู้จักในโครงใหม่ต้องหยุดทั้งงาน():
    assert "unknown_award" in problems({"Gold/a.pdf": PDF, "Platinum/b.pdf": PDF2})


def test_PDF_ลอยอยู่นอกโครงต้องปฏิเสธ():
    assert "no_mode" in problems({"online/Gold/a.pdf": PDF, "a.pdf": PDF})
    assert "no_award" in problems({"online/a.pdf": PDF})


def test_โฟลเดอร์รางวัลที่ไม่รู้จักต้องหยุดทั้งงาน_ไม่ใช่เดา():
    found = problems({"online/Gold/a.pdf": PDF, "online/Platinum/b.pdf": PDF})
    assert found["unknown_award"] == ["Platinum"]


def test_ข้อความผิดพลาดบอกชื่อโฟลเดอร์ที่รับ():
    with pytest.raises(ZipLayoutError) as err:
        preflight_zip(make_zip({"online/Platinum/b.pdf": PDF}), FINAL, 2026)
    assert "gold" in str(err.value)
    assert "Platinum" in str(err.value)


def test_รางวัลเข้าร่วมรับได้ในรอบ_Heat_แต่ปฏิเสธในรอบ_Final():
    heat = preflight_zip(make_zip({"online/Participation/a.pdf": HEAT_PDF}), HEAT, 2026)
    assert [b.award for b in heat.bundles] == ["PARTICIPATION"]
    assert "award_not_in_round" in problems({"online/Participation/a.pdf": PDF})


def test_รางวัลพิเศษรับได้ทั้งสองรอบ():
    assert preflight_zip(make_zip({"online/Special/a.pdf": PDF}), FINAL, 2026).bundles[0].award == "SPECIAL_AWARD"
    assert preflight_zip(make_zip({"onsite/Special Award/a.pdf": HEAT_PDF}), HEAT, 2026).bundles[0].award == "SPECIAL_AWARD"


def test_โฟลเดอร์ระดับชั้นใต้รางวัล_เฉพาะโปรไฟล์ที่ประกาศไว้():
    hkiso_heat = get_profile("HKISO", "HEAT")
    report = preflight_zip(make_zip({"online/Gold/P3/a.pdf": HEAT_PDF, "online/Gold/b.pdf": HEAT_PDF}), hkiso_heat, 2026)
    assert sorted(b.level_folder or "" for b in report.bundles) == ["", "P3"]
    award_only = preflight_zip(make_zip({"Gold/P3/a.pdf": HEAT_PDF}), hkiso_heat, 2026)
    assert (award_only.layout, award_only.bundles[0].level_folder) == ("AWARD_ONLY", "P3")
    assert "ambiguous_path" in problems({"Gold/Silver/a.pdf": HEAT_PDF}, hkiso_heat)
    # รายการที่ไม่ได้ประกาศไว้ ห้ามอ่านโฟลเดอร์ลึกกว่านั้น
    assert "too_deep" in problems({"online/Gold/P3/a.pdf": HEAT_PDF}, HEAT)


def test_BBB_เก็บรหัสรางวัลของตัวเอง():
    report = preflight_zip(make_zip({"online/1st Prize/a.pdf": PDF}), get_profile("BBB", "FINAL"), 2026)
    assert report.bundles[0].award == "1ST_PRIZE"
    assert report.bundles[0].award_label == "1st Prize"


def test_ไฟล์ที่เป็นของรอบหรือปีอื่นต้องปฏิเสธตั้งแต่ก่อนตัดหน้า():
    assert "wrong_round" in problems({"online/Gold/a.pdf": HEAT_PDF}, FINAL)
    assert "wrong_round" in problems({"online/Gold/a.pdf": PDF}, FINAL, 2025)


def test_ข้ามขยะจาก_macOS_และรายงานไฟล์ที่ไม่ใช่_PDF():
    report = preflight_zip(make_zip({
        "online/Gold/a.pdf": PDF,
        "__MACOSX/online/Gold/._a.pdf": b"junk",
        "online/Gold/._b.pdf": b"junk",
        "online/Gold/.DS_Store": b"junk",
        "online/Gold/scan.jpg": b"jpg",
    }), FINAL, 2026)
    assert len(report.bundles) == 1
    summary = report.to_dict()
    assert summary["unsupportedFiles"] == ["online/Gold/scan.jpg"]
    assert summary["ignoredCount"] == 3


def test_ZIP_ที่ไม่มี_PDF_เลย():
    assert "no_pdf" in problems({"online/Gold/readme.txt": b"hi"})


def test_PDF_เสียต้องปฏิเสธ():
    assert "unreadable" in problems({"online/Gold/a.pdf": b"not a pdf"})


def test_ไฟล์ที่ไม่ใช่_ZIP():
    with pytest.raises(ZipLayoutError, match="ไม่ใช่ ZIP"):
        preflight_zip(b"not a zip", FINAL, 2026)


def test_รายงานปัญหาทุกข้อในครั้งเดียว():
    found = problems({"loose.pdf": PDF, "online/Platinum/b.pdf": PDF, "online/c.pdf": PDF})
    assert {"no_mode", "unknown_award", "no_award"} <= found.keys()


def test_เก็บชื่อไฟล์ต้นทางไว้ไล่ย้อนได้():
    report = preflight_zip(make_zip({"HKIMO/onsite/Gold/THAILAND_Gold_Award.pdf": PDF}), FINAL, 2026)
    assert report.bundles[0].source_file == "HKIMO/onsite/Gold/THAILAND_Gold_Award.pdf"
