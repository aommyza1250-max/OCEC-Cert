"""ตรวจโครงสร้าง ZIP เกียรติบัตรให้ครบก่อนลงมือ แล้วค่อยอ่าน PDF ออกมาทีละไฟล์

โครงที่รองรับ (ZIP หนึ่งไฟล์เลือกโครงเดียว):

    online/<รางวัล>/*.pdf
    onsite/<รางวัล>/*.pdf
    <รางวัล>/*.pdf       # โหมดของแต่ละหน้าอ้างจากรายชื่อด้วยเลขบนใบ

  - ครอบด้วยโฟลเดอร์ชั้นนอกได้ 1 ชั้น (การซิปโฟลเดอร์บนเครื่องมักได้ชั้นนี้ติดมา)
        HKIMO/online/gold/a.pdf
  - โปรไฟล์ที่ประกาศไว้ (levelSubfolder) มีโฟลเดอร์ระดับชั้นใต้รางวัลได้อีก 1 ชั้น
        online/gold/P3/a.pdf

รางวัลอ่านจาก **ตำแหน่งที่กำหนดไว้เท่านั้น** (ถัดจากโฟลเดอร์ online/onsite)
ไม่หยิบโฟลเดอร์แม่ตรง ๆ และไม่ไล่หาโฟลเดอร์ชั้นบนไปเรื่อย ๆ จนเจออะไรที่หน้าตาเหมือนรางวัล
เพราะนั่นคือการเดา — รางวัลผิดแปลว่าเด็กได้เหรียญผิดบนหน้าเว็บ

**ตรวจทั้ง ZIP ให้เสร็จก่อน** แล้วค่อยตัดหน้าแรก เจอปัญหาข้อใดข้อหนึ่ง = ปฏิเสธทั้งไฟล์
โดยยังไม่แตะข้อมูลเดิมเลย และรายงานปัญหาทั้งหมดในครั้งเดียว ไม่ใช่ทีละข้อ
"""

from __future__ import annotations

import io
import zipfile
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

import pymupdf

from ..certificate_profiles import AwardCatalog, CertificateProfile, folder_key

# ขยะที่ระบบปฏิบัติการแถมมากับ zip เสมอ — ข้ามเงียบ ๆ ได้เพราะไม่ใช่เกียรติบัตรแน่นอน
IGNORED_PREFIXES = ("__MACOSX/",)
IGNORED_NAMES = frozenset({".DS_Store", "Thumbs.db", "desktop.ini"})

MODES = ("ONLINE", "ONSITE")

# ยกตัวอย่างปัญหาแต่ละแบบไม่เกินนี้ — ZIP จริงมีหลายร้อยไฟล์ ไล่ทั้งหมดอ่านไม่รู้เรื่อง
MAX_EXAMPLES = 5


@dataclass(frozen=True)
class Bundle:
    """PDF รวมเล่ม 1 ไฟล์ พร้อมรูปแบบการสอบและรางวัลที่อ่านได้จากตำแหน่งโฟลเดอร์

    `data` มีค่าเฉพาะตอนที่อ่านผ่าน open_bundles() ซึ่งอ่านทีละไฟล์
    เพื่อไม่ให้ต้องอม PDF ทุกไฟล์ไว้ในหน่วยความจำพร้อมกัน
    """

    mode: str | None
    award: str
    award_label: str
    source_file: str
    level_folder: str | None = None
    pages: int = 0
    data: bytes = b""


class ZipLayoutError(ValueError):
    """โครงสร้างใน ZIP ไม่ตรงกับที่โปรไฟล์รองรับ — เป็นความผิดพลาดของไฟล์ ไม่ใช่ระบบพัง"""

    def __init__(self, message: str, report: dict[str, Any]) -> None:
        super().__init__(message)
        self.report = report


@dataclass
class Preflight:
    """ผลตรวจ ZIP ก่อนลงมือ — แสดงให้แอดมินเห็นทุกครั้ง ไม่ว่าจะผ่านหรือไม่"""

    profile_key: str
    # ชื่อโฟลเดอร์รางวัลที่รอบนี้รับ — ใส่ไว้ในข้อความผิดพลาดให้แอดมินแก้ได้ทันที
    accepted_folders: list[str] = field(default_factory=list)
    bundles: list[Bundle] = field(default_factory=list)
    layout: str | None = None
    wrapper: str | None = None
    unsupported: list[str] = field(default_factory=list)
    ignored: int = 0
    problems: dict[str, list[str]] = field(default_factory=dict)

    def problem(self, kind: str, example: str) -> None:
        self.problems.setdefault(kind, []).append(example)

    def to_dict(self) -> dict[str, Any]:
        by_mode: dict[str, dict[str, int]] = {}
        by_award: Counter[str] = Counter()
        for b in self.bundles:
            if b.mode:
                mode = by_mode.setdefault(b.mode, {"files": 0, "pages": 0})
                mode["files"] += 1
                mode["pages"] += b.pages
            by_award[b.award] += b.pages
        return {
            "profileKey": self.profile_key,
            "layout": self.layout,
            "files": len(self.bundles),
            "pages": sum(b.pages for b in self.bundles),
            "modes": by_mode,
            "awards": dict(by_award),
            "byModeAward": _pages_by_mode_award(self.bundles),
            "wrapper": self.wrapper,
            "unsupportedFiles": self.unsupported[:MAX_EXAMPLES],
            "unsupportedCount": len(self.unsupported),
            "ignoredCount": self.ignored,
            "problems": {kind: examples[:MAX_EXAMPLES] for kind, examples in self.problems.items()},
            "problemCounts": {kind: len(examples) for kind, examples in self.problems.items()},
        }


def _pages_by_mode_award(bundles: list[Bundle]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for b in bundles:
        if not b.mode:
            continue
        slot = out.setdefault(b.mode, {})
        slot[b.award] = slot.get(b.award, 0) + b.pages
    return out


# ข้อความหัวข้อปัญหา — แอดมินอ่านตรง ๆ บนหน้าจอ
PROBLEM_TEXT = {
    "no_pdf": "ไม่พบไฟล์ PDF ใน ZIP เลย",
    "no_mode": "ไฟล์ PDF ที่ไม่ได้อยู่ในโฟลเดอร์ online หรือ onsite",
    "mode_twice": "ไฟล์ที่มีทั้งโฟลเดอร์ online และ onsite ซ้อนกันในเส้นทางเดียว (บอกไม่ได้ว่าเป็นแบบไหน)",
    "too_deep_wrapper": "โฟลเดอร์ online/onsite ซ้อนอยู่ลึกเกินหนึ่งชั้น (มีโฟลเดอร์ครอบได้ชั้นเดียว)",
    "no_award": "ไฟล์ PDF ที่วางอยู่ในโฟลเดอร์ online/onsite ตรง ๆ โดยไม่มีโฟลเดอร์รางวัล",
    "too_deep": "ไฟล์ที่อยู่ลึกเกินโครงที่รองรับ",
    "unknown_award": "โฟลเดอร์ที่ไม่รู้ว่าเป็นรางวัลอะไร",
    "award_not_in_round": "รางวัลที่ไม่มีในรอบนี้",
    "many_wrappers": "มีโฟลเดอร์ครอบชั้นนอกหลายชื่อ (ต้องมีชั้นเดียวชื่อเดียวกันทั้ง ZIP)",
    "unreadable": "ไฟล์ PDF ที่เปิดไม่ได้",
    "empty_pdf": "ไฟล์ PDF ที่ไม่มีหน้าเลย",
    "wrong_round": "ไฟล์ที่เป็นเกียรติบัตรของรอบหรือปีอื่น",
    "mixed_layout": "มีทั้งไฟล์แบบแยก online/onsite และแบบแยกตามรางวัลอย่างเดียวใน ZIP เดียวกัน",
    "ambiguous_path": "เส้นทางมีชื่อรางวัลสองชั้น จึงบอกไม่ได้ว่าชั้นไหนคือรางวัล",
}


def preflight_zip(zip_source, profile: CertificateProfile, batch_year: int | None = None) -> Preflight:
    """ตรวจโครงสร้าง ZIP ทั้งไฟล์ — ไม่มีปัญหาเลยจึงคืนผล มีปัญหาแม้ข้อเดียวโยน ZipLayoutError

    รับได้ทั้ง path ของไฟล์บนดิสก์ และ bytes (ใช้ในเทส)
    เปิด PDF ทีละไฟล์เพื่อนับหน้า — ไม่อม PDF ทั้งหมดไว้พร้อมกัน
    """
    catalog = profile.catalog
    report = Preflight(
        profile_key=profile.key,
        accepted_folders=[a.folders[0].lower() for a in catalog.awards],
    )
    policy = profile.path_policy
    wrappers: set[str | None] = set()
    located: list[tuple[str, str | None, str, str | None]] = []

    with _open_zip(zip_source) as zf:
        for info in zf.infolist():
            name = info.filename
            if info.is_dir():
                continue
            if _is_ignored(name):
                report.ignored += 1
                continue
            if not name.lower().endswith(".pdf"):
                report.unsupported.append(name)
                continue

            found = _locate(name, policy.level_subfolder, catalog)
            if isinstance(found, str):
                report.problem(found, name)
                continue
            wrapper, mode, award_folder, level_folder = found
            wrappers.add(wrapper)

            award = catalog.resolve_folder(award_folder)
            if award is None:
                excluded = catalog.excluded_folder(award_folder)
                if excluded:
                    report.problem("award_not_in_round",
                                   f"{award_folder} ({excluded.code} ใช้ได้เฉพาะรอบ "
                                   f"{', '.join(excluded.rounds)})")
                else:
                    report.problem("unknown_award", award_folder)
                continue
            located.append((name, mode, award.code, level_folder))

        found_modes = {mode is not None for _, mode, _, _ in located}
        if len(found_modes) > 1:
            report.problem("mixed_layout", "แยกไฟล์เป็น ZIP คนละรูปแบบก่อนอัปโหลด")
        if found_modes:
            report.layout = "MODE_AWARD" if True in found_modes else "AWARD_ONLY"
        if len(wrappers) > 1:
            report.problem("many_wrappers", ", ".join(sorted(w or "(ไม่มี)" for w in wrappers)))
        report.wrapper = next(iter(wrappers)) if len(wrappers) == 1 else None

        # เปิดทีละไฟล์เพื่อนับหน้าและตรวจรอบ/ปีจากหน้าแรก — เจอไฟล์ผิดชุดตั้งแต่ตอนนี้
        # ดีกว่าไปตัดหน้าทั้งเล่มแล้วค่อยพบว่าเป็นของรอบอื่นทุกหน้า
        for name, mode, code, level_folder in located:
            pages, wrong = _inspect_pdf(zf.read(name), profile, batch_year)
            if pages is None:
                report.problem("unreadable", name)
                continue
            if pages == 0:
                report.problem("empty_pdf", name)
                continue
            if wrong:
                report.problem("wrong_round", f"{name}: {wrong}")
            award = catalog.get(code)
            report.bundles.append(
                Bundle(mode=mode, award=code, award_label=award.label, source_file=name,
                       level_folder=level_folder, pages=pages)
            )

    if not report.bundles and not report.problems:
        report.problem("no_pdf", "(ว่าง)")
    report.problems = {k: sorted(set(v)) for k, v in report.problems.items()}
    report.bundles.sort(key=lambda b: (b.mode or "", catalog.get(b.award).order, b.source_file))

    if report.problems:
        raise ZipLayoutError(_describe(report), report.to_dict())
    return report


def _locate(
    name: str, level_subfolder: bool, catalog: AwardCatalog
) -> tuple[str | None, str | None, str, str | None] | str:
    """หาตำแหน่งโฟลเดอร์โหมด (ถ้ามี) และโฟลเดอร์รางวัลของไฟล์นี้

    คืน (โฟลเดอร์ครอบ, รูปแบบ, โฟลเดอร์รางวัล, โฟลเดอร์ระดับชั้น) หรือชนิดปัญหาเป็นข้อความ
    """
    dirs = list(PurePosixPath(name).parts[:-1])
    positions = [i for i, d in enumerate(dirs) if folder_key(d) in MODES]
    if not positions:
        if len(dirs) == 1:
            return None, None, dirs[0], None
        if len(dirs) == 2:
            if level_subfolder and catalog.resolve_folder(dirs[0]):
                if catalog.resolve_folder(dirs[1]):
                    return "ambiguous_path"
                return None, None, dirs[0], dirs[1]
            return dirs[0], None, dirs[1], None
        if len(dirs) == 3 and level_subfolder:
            if catalog.resolve_folder(dirs[0]) and catalog.resolve_folder(dirs[1]):
                return "ambiguous_path"
            return dirs[0], None, dirs[1], dirs[2]
        return "no_mode" if not dirs else "too_deep"
    if len(positions) > 1:
        return "mode_twice"
    index = positions[0]
    if index > 1:
        return "too_deep_wrapper"

    wrapper = dirs[0] if index == 1 else None
    rest = dirs[index + 1:]
    if not rest:
        return "no_award"
    if len(rest) == 1:
        return wrapper, folder_key(dirs[index]), rest[0], None
    if len(rest) == 2 and level_subfolder:
        return wrapper, folder_key(dirs[index]), rest[0], rest[1]
    return "too_deep"


def _inspect_pdf(data: bytes, profile: CertificateProfile, batch_year: int | None) -> tuple[int | None, str | None]:
    """นับหน้า และอ่านหน้าแรกดูว่าเป็นของรอบ/ปีนี้จริงไหม — คืน (จำนวนหน้า, ปัญหา)"""
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.page_count == 0:
                return 0, None
            parsed = profile.parse(doc[0].get_text("text") or "", batch_year)
            return doc.page_count, ("; ".join(parsed.errors) or None)
    except Exception:  # ไฟล์เสีย เข้ารหัส หรือไม่ใช่ PDF จริง — PyMuPDF โยนได้หลายชนิด
        return None, None


def _describe(report: Preflight) -> str:
    """ข้อความผิดพลาดบรรทัดแรกสำหรับแอดมิน ตามด้วยรายการปัญหาทั้งหมด"""
    lines = ["โครงสร้างไฟล์ ZIP ไม่ถูกต้อง จึงยังไม่นำเข้าอะไรเลย:"]
    for kind, examples in report.problems.items():
        shown = ", ".join(examples[:MAX_EXAMPLES])
        more = f" และอีก {len(examples) - MAX_EXAMPLES} รายการ" if len(examples) > MAX_EXAMPLES else ""
        lines.append(f"- {PROBLEM_TEXT.get(kind, kind)}: {shown}{more}")
    if {"unknown_award", "award_not_in_round"} & report.problems.keys():
        lines.append(f"(โฟลเดอร์รางวัลที่รอบนี้รับ: {', '.join(report.accepted_folders)})")
    if {"no_mode", "no_award", "too_deep", "too_deep_wrapper"} & report.problems.keys():
        lines.append("(โครงที่รองรับ: online/<รางวัล>/ไฟล์.pdf, onsite/<รางวัล>/ไฟล์.pdf หรือ <รางวัล>/ไฟล์.pdf)")
    return "\n".join(lines)


@contextmanager
def open_bundles(zip_source, bundles: list[Bundle]) -> Iterator[Iterator[Bundle]]:
    """อ่านเนื้อไฟล์ทีละ PDF — ในหน่วยความจำจะมี PDF อยู่ครั้งละไฟล์เดียว

    ZIP จริงขนาด 359 MB มี PDF ข้างในรวม 385 MB ถ้าอ่านทั้งหมดพร้อมกันจะกินแรมเกิน
    """

    def generate(zf) -> Iterator[Bundle]:
        for bundle in bundles:
            yield Bundle(
                mode=bundle.mode, award=bundle.award, award_label=bundle.award_label,
                source_file=bundle.source_file, level_folder=bundle.level_folder,
                pages=bundle.pages, data=zf.read(bundle.source_file),
            )

    with _open_zip(zip_source) as zf:
        yield generate(zf)


@contextmanager
def _open_zip(source):
    """รับได้ทั้ง path (str/Path) และ bytes"""
    try:
        if isinstance(source, (bytes, bytearray)):
            with zipfile.ZipFile(io.BytesIO(source)) as zf:
                yield zf
        else:
            with zipfile.ZipFile(source) as zf:
                yield zf
    except zipfile.BadZipFile as exc:
        raise ZipLayoutError(
            "ไฟล์ที่อัปขึ้นมาไม่ใช่ ZIP ที่เปิดได้ — กรุณาบีบอัดใหม่แล้วอัปอีกครั้ง",
            {"problems": {"bad_zip": [str(exc)]}, "problemCounts": {"bad_zip": 1}},
        ) from exc


def _is_ignored(name: str) -> bool:
    if name.startswith(IGNORED_PREFIXES):
        return True
    base = PurePosixPath(name).name
    # ไฟล์ AppleDouble (._xxx.pdf) ที่ Mac สร้างเมื่อซิปจากไดรฟ์ภายนอก — ไม่ใช่ PDF จริง
    return base in IGNORED_NAMES or base.startswith("._")
