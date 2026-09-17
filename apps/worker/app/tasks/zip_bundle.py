"""อ่านไฟล์ ZIP ที่แอดมินอัปโหลด แล้วจับคู่ PDF แต่ละไฟล์เข้ากับรางวัลจากชื่อโฟลเดอร์

ทำไมต้องอ่านรางวัลจากโฟลเดอร์: หน้าเกียรติบัตร Perfect Score ของจริง **ไม่มีข้อความรางวัล
พิมพ์อยู่บนหน้าเลย** ชื่อโฟลเดอร์จึงเป็นแหล่งเดียวที่รู้รางวัลได้ครบทุกใบ

โครงสร้างที่รองรับ (มีหรือไม่มีโฟลเดอร์ครอบชั้นนอกก็ได้ เพราะการซิปโฟลเดอร์บนเครื่อง
มักได้ชั้นครอบติดมาด้วย):

    gold/*.pdf                 หรือ      HKIMO/gold/*.pdf
    perfect score/*.pdf                  HKIMO/Perfect_Score/*.pdf
"""

import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import PurePosixPath

from ..normalize import normalize_award

# ขยะที่เครื่อง Mac แถมมากับ zip เสมอ
IGNORED_PREFIXES = ("__MACOSX/",)
IGNORED_NAMES = (".DS_Store", "Thumbs.db")


@dataclass(frozen=True)
class Bundle:
    """PDF รวมเล่ม 1 ไฟล์ พร้อมรางวัลที่อ่านได้จากโฟลเดอร์ที่มันอยู่

    `data` มีค่าเฉพาะตอนที่อ่านผ่าน open_bundles() ซึ่งอ่านทีละไฟล์
    เพื่อไม่ให้ต้องอม PDF ทุกไฟล์ไว้ในหน่วยความจำพร้อมกัน
    """

    award: str
    source_file: str
    data: bytes = b""


class ZipLayoutError(ValueError):
    """โครงสร้างใน ZIP ไม่ตรงกับที่ระบบรองรับ"""


def read_award_bundles(zip_source) -> list[Bundle]:
    """ตรวจโครงสร้าง ZIP แล้วคืนรายการไฟล์ PDF พร้อมรางวัล (ยังไม่อ่านเนื้อไฟล์)

    รับได้ทั้ง path ของไฟล์บนดิสก์ และ bytes (ใช้ในเทส)

    รางวัลอ่านจาก **ชื่อโฟลเดอร์ที่ไฟล์นั้นอยู่โดยตรง**
    เจอโฟลเดอร์ที่แปลงเป็นรางวัลไม่ได้ หรือมี PDF วางอยู่นอกโฟลเดอร์ -> โยน ZipLayoutError
    ตั้งใจให้หยุดทั้งงาน เพราะเดารางวัลผิดแปลว่าเด็กได้เหรียญผิดบนหน้าเว็บ
    """
    bundles: list[Bundle] = []
    unknown_folders: set[str] = set()
    loose_files: list[str] = []

    with _open_zip(zip_source) as zf:
        for info in zf.infolist():
            name = info.filename
            if info.is_dir() or _is_ignored(name):
                continue
            if not name.lower().endswith(".pdf"):
                continue

            folder = PurePosixPath(name).parent.name
            if not folder:
                loose_files.append(name)
                continue

            award = normalize_award(folder)
            if not award:
                unknown_folders.add(folder)
                continue

            bundles.append(Bundle(award=award, source_file=name))

    _raise_if_broken(bundles, unknown_folders, loose_files)
    return sorted(bundles, key=lambda b: (b.award, b.source_file))


@contextmanager
def open_bundles(zip_source, bundles: list[Bundle]) -> Iterator[Iterator[Bundle]]:
    """อ่านเนื้อไฟล์ทีละ PDF — ในหน่วยความจำจะมี PDF อยู่ครั้งละไฟล์เดียว

    ZIP จริงขนาด 359 MB มี PDF ข้างในรวม 385 MB ถ้าอ่านทั้งหมดพร้อมกันจะกินแรมเกิน
    """

    def generate(zf) -> Iterator[Bundle]:
        for bundle in bundles:
            yield Bundle(award=bundle.award, source_file=bundle.source_file,
                         data=zf.read(bundle.source_file))

    with _open_zip(zip_source) as zf:
        yield generate(zf)


@contextmanager
def _open_zip(source):
    """รับได้ทั้ง path (str/Path) และ bytes"""
    if isinstance(source, (bytes, bytearray)):
        import io as _io

        with zipfile.ZipFile(_io.BytesIO(source)) as zf:
            yield zf
    else:
        with zipfile.ZipFile(source) as zf:
            yield zf


def _is_ignored(name: str) -> bool:
    if name.startswith(IGNORED_PREFIXES):
        return True
    return PurePosixPath(name).name in IGNORED_NAMES


def _raise_if_broken(
    bundles: list[Bundle], unknown_folders: set[str], loose_files: list[str]
) -> None:
    problems = []
    if unknown_folders:
        problems.append(
            "โฟลเดอร์ที่ไม่รู้ว่าเป็นรางวัลอะไร: "
            + ", ".join(sorted(unknown_folders))
            + " (ที่รองรับ: gold, silver, bronze, merit, perfect score)"
        )
    if loose_files:
        problems.append(
            "ไฟล์ PDF ที่วางอยู่นอกโฟลเดอร์รางวัล: " + ", ".join(sorted(loose_files)[:5])
        )
    if not bundles and not problems:
        problems.append("ไม่พบไฟล์ PDF ใน ZIP เลย")

    if problems:
        raise ZipLayoutError(
            "โครงสร้างไฟล์ ZIP ไม่ถูกต้อง จึงหยุดไว้ก่อนเพื่อไม่ให้รางวัลผิด:\n- "
            + "\n- ".join(problems)
        )
