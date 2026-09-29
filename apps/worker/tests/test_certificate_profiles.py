"""เทสโปรไฟล์เกียรติบัตรรายรายการสอบ และแคตตาล็อกรางวัลกลาง

เคสแคตตาล็อกมาจาก shared/certificate-profile-cases.json ไฟล์เดียวกับที่ vitest ฝั่งเว็บใช้
หน้าเกียรติบัตรทั้งหมดสร้างสดด้วย tests/fixtures/builders.py ไม่มีไฟล์จริง
"""

import json

import pymupdf
import pytest

from app.certificate_profiles import (
    FromField,
    Nationality,
    ParsedCertificate,
    UnsupportedProfile,
    folder_key,
    get_profile,
    load_manifests,
    registered_profiles,
)
from app.certificate_profiles.base import CertificateProfile
from app.certificate_profiles.manifest import parse_manifest, profiles_dir
from app.certificate_profiles.registry import PROFILES
from tests.fixtures.builders import make_bundle_pdf


def _cases() -> dict:
    return json.loads((profiles_dir().parent / "certificate-profile-cases.json").read_text("utf-8"))


CASES = _cases()


def text_of(entry: dict) -> str:
    """ข้อความของหน้าเกียรติบัตรสังเคราะห์ 1 หน้า ตามที่ get_text อ่านได้จริง"""
    with pymupdf.open(stream=make_bundle_pdf([entry]), filetype="pdf") as doc:
        return doc[0].get_text("text")


# ---------------------------------------------------------------- แคตตาล็อกร่วมกับเว็บ


@pytest.mark.parametrize("case", CASES["folderKeys"], ids=[c["why"] for c in CASES["folderKeys"]])
def test_folder_key_ตรงกับฝั่งเว็บ(case):
    assert folder_key(case["input"]) == case["key"]


@pytest.mark.parametrize("case", CASES["folders"], ids=[c["why"] for c in CASES["folders"]])
def test_ชื่อโฟลเดอร์แปลงเป็นรางวัลตรงกับฝั่งเว็บ(case):
    award = get_profile(case["program"], case["round"]).catalog.resolve_folder(case["folder"])
    assert (award.code if award else None) == case["award"]


@pytest.mark.parametrize("case", CASES["profiles"], ids=[f"{c['program']}_{c['round']}" for c in CASES["profiles"]])
def test_คีย์โปรไฟล์จากแคตตาล็อก(case):
    assert load_manifests().profile_key(case["program"], case["round"]) == case["profileKey"]


def test_ทุกคู่ในแคตตาล็อกมีโปรไฟล์_Python_หนึ่งตัวพอดี():
    manifest_pairs = set(load_manifests().supported_pairs())
    python_pairs = [(p.program, p.round) for p in registered_profiles()]
    assert len(python_pairs) == len(set(python_pairs))
    assert set(python_pairs) == manifest_pairs
    for profile in registered_profiles():
        assert profile.key == load_manifests().profile_key(profile.program, profile.round)


def test_คู่ที่ไม่มีโปรไฟล์ต้องปฏิเสธ_ไม่มีโปรไฟล์กลาง():
    with pytest.raises(UnsupportedProfile):
        get_profile("NOPE", "HEAT")
    with pytest.raises(UnsupportedProfile):
        get_profile("HKIMO", "SEMIFINAL")


def test_ทุกรายการรองรับรางวัลพิเศษและรางวัลเข้าร่วมตามสเปก():
    for program, _ in load_manifests().supported_pairs():
        heat = get_profile(program, "HEAT").catalog
        final = get_profile(program, "FINAL").catalog
        assert heat.get("SPECIAL_AWARD").kind == "SUPPLEMENTAL"
        assert final.get("SPECIAL_AWARD").kind == "SUPPLEMENTAL"
        assert heat.get("PARTICIPATION").kind == "PRIMARY"
        assert final.get("PARTICIPATION") is None
        assert final.excluded_folder("Participation").code == "PARTICIPATION"


def test_ชื่อโฟลเดอร์ไม่ซ้ำกันภายในรายการเดียว():
    for program, exam_round in load_manifests().supported_pairs():
        keys = [k for a in get_profile(program, exam_round).catalog.awards for k in a.folders]
        assert len(keys) == len(set(keys)), (program, exam_round)


def test_แคตตาล็อกที่ชื่อชนกันต้องโหลดไม่ผ่าน():
    bad = {
        "program": "XYZ",
        "rounds": {"HEAT": {"profileKey": "XYZ_HEAT", "levelSubfolder": False}},
        "awards": [
            {"code": "GOLD", "kind": "PRIMARY", "rounds": ["HEAT"], "folders": ["Gold"], "order": 1, "badge": "gold"},
            {"code": "FIRST", "kind": "PRIMARY", "rounds": ["HEAT"], "folders": ["gold"], "order": 2, "badge": "gold"},
        ],
    }
    with pytest.raises(ValueError, match="GOLD"):
        parse_manifest(bad)


def test_BBB_เก็บชื่อรางวัลจริง_ไม่ยุบเป็นเหรียญ():
    catalog = get_profile("BBB", "FINAL").catalog
    first = catalog.resolve_folder("1st Prize")
    assert first.code == "1ST_PRIZE"
    assert first.label == "1st Prize"
    assert catalog.get("GOLD") is None


def test_ข้อความรางวัลบนหน้าแปลได้เพื่อตรวจทาน():
    bbb = get_profile("BBB", "HEAT").catalog
    assert bbb.resolve_text("3rdPrize").code == "3RD_PRIZE"
    assert bbb.resolve_text("Certificate of Participation").code == "PARTICIPATION"
    hkimo = get_profile("HKIMO", "FINAL").catalog
    assert hkimo.resolve_text("PERFECT SCORER").code == "PERFECT_SCORE"
    assert hkimo.resolve_text("GOLD AWARD").code == "GOLD"
    assert hkimo.resolve_text("Platinum") is None


# ---------------------------------------------------------------- สัญญากลาง


HEAT_PAGE = {
    "name": "SOMCHAI JAIDEE", "school": "SAMPLE WITTAYA SCHOOL", "level": "PRIMARY 3",
    "cert_no": "5000001", "round": "Heat", "year": 2026,
}
FINAL_PAGE = {
    "name": "SOMCHAI JAIDEE", "country": "THAILAND", "level": "PRIMARY 3",
    "cert_no": "200001", "award": "Gold", "round": "Final", "year": 2026,
}


@pytest.mark.parametrize("profile", registered_profiles(), ids=lambda p: p.key)
def test_ทุกโปรไฟล์คืนผลรูปแบบเดียวกัน(profile):
    page = HEAT_PAGE if profile.round == "HEAT" else FINAL_PAGE
    parsed = profile.parse(text_of(page), 2026)
    assert isinstance(parsed, ParsedCertificate)
    assert parsed.name == "SOMCHAI JAIDEE"
    assert parsed.candidate_no == page["cert_no"]
    assert parsed.level == "PRIMARY 3"
    assert parsed.round_on_page == profile.round
    assert parsed.year_on_page == 2026
    assert parsed.errors == ()


@pytest.mark.parametrize("profile", [p for p in registered_profiles() if p.round == "HEAT"], ids=lambda p: p.key)
def test_รอบ_Heat_ค่าหลัง_from_คือโรงเรียน_และรับทุกหน้า(profile):
    parsed = profile.parse(text_of(HEAT_PAGE), 2026)
    assert profile.from_field is FromField.SCHOOL
    assert parsed.school_on_page == "SAMPLE WITTAYA SCHOOL"
    assert parsed.country_on_page is None
    assert profile.nationality(parsed) is Nationality.ACCEPT


@pytest.mark.parametrize("profile", [p for p in registered_profiles() if p.round == "FINAL"], ids=lambda p: p.key)
def test_รอบ_Final_ค่าหลัง_from_คือประเทศ(profile):
    thai = profile.parse(text_of(FINAL_PAGE), 2026)
    assert thai.country_on_page == "THAILAND"
    assert thai.school_on_page is None
    assert profile.nationality(thai) is Nationality.ACCEPT

    foreign = profile.parse(text_of(dict(FINAL_PAGE, country="JAPAN")), 2026)
    assert profile.nationality(foreign) is Nationality.FOREIGN


@pytest.mark.parametrize("profile", [p for p in registered_profiles() if p.round == "FINAL"], ids=lambda p: p.key)
def test_รอบ_Final_ไม่มีหลักฐานสัญชาติ_ต้องส่งให้แอดมิน_ไม่ทิ้งและไม่เดา(profile):
    no_country = profile.parse(text_of(dict(FINAL_PAGE, country=None)), 2026)
    assert profile.nationality(no_country) is Nationality.UNVERIFIED


def test_หน้าที่พิมพ์รอบหรือปีไม่ตรงกับรอบนำเข้าต้องหยุดให้ตรวจ():
    profile = get_profile("HKIMO", "FINAL")
    wrong_round = profile.parse(text_of(dict(FINAL_PAGE, round="Heat")), 2026)
    assert any("รอบ HEAT" in e for e in wrong_round.errors)
    wrong_year = profile.parse(text_of(FINAL_PAGE), 2025)
    assert any("ปี 2026" in e for e in wrong_year.errors)


def test_ช่วงปีการศึกษาเทียบได้ทั้งปีต้นและปีท้าย():
    profile = get_profile("TIMO", "HEAT")
    page = dict(HEAT_PAGE, year="2025 - 2026")
    parsed = profile.parse(text_of(page), 2026)
    assert parsed.year_on_page == 2026
    assert parsed.extra["academicYear"] == "2025 - 2026"
    assert parsed.errors == ()
    assert profile.parse(text_of(page), 2025).errors == ()
    assert profile.parse(text_of(page), 2024).errors != ()


# ---------------------------------------------------------------- ความต่างเฉพาะรายการ


def test_BBB_ไม่มีบรรทัด_This_is_awarded_to_ก็อ่านชื่อได้():
    profile = get_profile("BBB", "HEAT")
    page = dict(HEAT_PAGE, anchor=False, award="1st Prize",
                title="Guangdong-Hong Kong-Macao Greater Bay Area Mathematical Olympiad")
    parsed = profile.parse(text_of(page), 2026)
    assert parsed.name == "SOMCHAI JAIDEE"
    assert profile.catalog.resolve_text(parsed.award_text).code == "1ST_PRIZE"


def test_BBB_ไม่มีบรรทัด_from_ใช้บรรทัดถัดจากรางวัล():
    profile = get_profile("BBB", "HEAT")
    page = dict(HEAT_PAGE, anchor=False, school=None, award_line="Certificate of Participation")
    parsed = profile.parse(text_of(page), 2026)
    assert parsed.name == "SOMCHAI JAIDEE"
    assert profile.catalog.resolve_text(parsed.award_text).code == "PARTICIPATION"


def test_HKICO_แยกวิชาออกจากระดับชั้น():
    profile = get_profile("HKICO", "HEAT")
    parsed = profile.parse(text_of(dict(HEAT_PAGE, level="PRIMARY 2 in SCRATCH", year="2025 - 2026")), 2026)
    assert parsed.level == "PRIMARY 2"
    assert parsed.extra["subject"] == "SCRATCH"


def test_HKICO_ใบรางวัลพิเศษรอบ_Final():
    profile = get_profile("HKICO", "FINAL")
    page = dict(FINAL_PAGE, award=None, level="SECONDARY 1 in BLOCKLY", achievement="1ST RUNNER-UP",
                event="Project", year="2025 - 2026")
    parsed = profile.parse(text_of(page), 2026)
    assert parsed.level == "SECONDARY 1"
    assert parsed.extra == {"achievement": "1ST RUNNER-UP", "subject": "BLOCKLY",
                            "event": "Project", "academicYear": "2025 - 2026"}
    assert parsed.round_on_page is None
    assert parsed.year_on_page == 2026
    assert parsed.errors == ()


def test_HKISO_ใบรางวัลพิเศษรอบ_Final():
    profile = get_profile("HKISO", "FINAL")
    page = dict(FINAL_PAGE, award=None, achievement="CHAMPION", event="Experiment", year="2025 - 2026")
    parsed = profile.parse(text_of(page), 2026)
    assert parsed.level == "PRIMARY 3"
    assert parsed.extra["achievement"] == "CHAMPION"
    assert parsed.extra["event"] == "Experiment"


def test_HKISO_รอบ_Heat_ประกาศว่ามีโฟลเดอร์ระดับชั้นได้_รายการอื่นไม่ได้():
    assert get_profile("HKISO", "HEAT").path_policy.level_subfolder is True
    assert get_profile("HKISO", "FINAL").path_policy.level_subfolder is False
    assert get_profile("HKIMO", "HEAT").path_policy.level_subfolder is False


def test_ชื่อที่ลงท้ายด้วยตัวอักษร_AWARD_ต้องไม่กลายเป็นบรรทัดรางวัล():
    # ของจริงเจอใน HKICO — นามสกุลลงท้ายด้วย ...AWARD
    profile = get_profile("HKICO", "HEAT")
    parsed = profile.parse(text_of(dict(HEAT_PAGE, name="MALEE TESTAWARD")), 2026)
    assert parsed.award_text is None
    assert parsed.name == "MALEE TESTAWARD"


def test_หน้าที่ไม่มีบรรทัดชื่อ_ไม่หยิบบรรทัดอื่นมาแทน():
    # ของจริงเจอใน HKIMO Heat: ต้นทางพิมพ์ใบโดยไม่มีชื่อ
    profile = get_profile("HKIMO", "HEAT")
    parsed = profile.parse(text_of(dict(HEAT_PAGE, name=None)), 2026)
    assert parsed.name is None
    assert parsed.candidate_no == "5000001"


# ---------------------------------------------------------------- แยกกันจริง


def test_เพิ่มโปรไฟล์ใหม่ไม่เปลี่ยนผลของโปรไฟล์อื่น():
    text = text_of(HEAT_PAGE)
    before = {key: p.parse(text, 2026) for key, p in PROFILES.items()}

    class Weird(CertificateProfile):
        name_anchor = "SOMETHING ELSE"

        def extract_name(self, lines):
            return "NOT A REAL NAME"

    registry = dict(PROFILES)
    registry[("WEIRD", "HEAT")] = Weird("WEIRD", "HEAT", from_field=FromField.SCHOOL,
                                        nationality_policy=get_profile("HKIMO", "HEAT").nationality_policy)
    registry[("WEIRD", "HEAT")].parse(text, 2026)

    after = {key: p.parse(text, 2026) for key, p in PROFILES.items()}
    assert before == after
    assert CertificateProfile.name_anchor == "This is awarded to"


def test_โปรไฟล์ไม่อ่านค่าจาก_environment(monkeypatch):
    # กติกาอ่านหน้าอยู่ในโค้ดของโปรไฟล์เท่านั้น ตัวแปร environment แบบเดิมต้องไม่มีผลอีกแล้ว
    profile = get_profile("HKIMO", "FINAL")
    text = text_of(FINAL_PAGE)
    before = profile.parse(text, 2026)
    monkeypatch.setenv("NAME_ANCHOR", "Awarded")
    monkeypatch.setenv("CERT_NO_PATTERN", r"(\d{2})")
    assert profile.parse(text, 2026) == before
