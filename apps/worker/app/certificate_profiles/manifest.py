"""อ่านแคตตาล็อกรางวัลจาก shared/certificate-profiles/*.json

ไฟล์ชุดเดียวกันนี้เว็บก็อ่าน (apps/web/src/lib/certificate-catalog.ts)
ชื่อรางวัลที่แสดงบนหน้าเว็บกับชื่อโฟลเดอร์ที่ worker ยอมรับจึงมาจากที่เดียวกันเสมอ

ไฟล์ผิดรูปแบบ = โยน error ตอนโหลด ไม่ปล่อยให้ไปพังกลางงานนำเข้า
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..normalize import basic_clean

ROUNDS = ("HEAT", "FINAL")
KINDS = ("PRIMARY", "SUPPLEMENTAL")

# คำท้ายที่ไม่ช่วยบอกว่าเป็นรางวัลอะไร ใช้เฉพาะตอนแปลข้อความบนหน้า/ในชีทไว้ตรวจทาน
# ห้ามใช้กับชื่อโฟลเดอร์ — ชื่อโฟลเดอร์ต้องตรงกับรายการที่ประกาศไว้เป๊ะ ๆ
TEXT_NOISE = frozenset({"AWARD", "AWARDS", "SCORER", "SCORERS", "MEDAL", "MEDALS"})


def folder_key(name: str) -> str:
    """รูปที่ใช้เทียบชื่อโฟลเดอร์: ไม่สนตัวพิมพ์ ขีดล่าง และช่องว่างซ้ำ

    'Perfect_Score', 'perfect score', 'PERFECT-SCORE' -> 'PERFECT SCORE'
    ⚠️ ต้องตรงกับ folderKey() ใน apps/web/src/lib/certificate-catalog.ts
    เคสทดสอบร่วมอยู่ที่ shared/certificate-profile-cases.json
    """
    return basic_clean(name)


@dataclass(frozen=True)
class AwardDef:
    code: str
    label: str
    label_th: str | None
    kind: str
    rounds: tuple[str, ...]
    # ชื่อโฟลเดอร์ที่ยอมรับ (เก็บในรูป folder_key แล้ว)
    folders: tuple[str, ...]
    # ข้อความรูปแบบอื่นที่เจอบนหน้าหรือในชีท ใช้ตรวจทานเท่านั้น (รูป folder_key)
    text: tuple[str, ...]
    order: int
    badge: str

    @property
    def is_primary(self) -> bool:
        return self.kind == "PRIMARY"


@dataclass(frozen=True)
class PathPolicy:
    """โครงโฟลเดอร์ใน ZIP ที่โปรไฟล์ยอมรับ

    พื้นฐาน: [โฟลเดอร์ครอบ 1 ชั้น]/online|onsite/<รางวัล>/*.pdf
    level_subfolder: ยอมให้มีโฟลเดอร์ระดับชั้นอีก 1 ชั้นใต้โฟลเดอร์รางวัล (HKISO Heat: Gold/P3/)
    """

    level_subfolder: bool = False


@dataclass(frozen=True)
class AwardCatalog:
    program: str
    round: str
    # รางวัลที่ใช้ได้ในรอบนี้ เรียงตามลำดับการแสดงผล
    awards: tuple[AwardDef, ...]
    # รางวัลของรายการนี้ที่ไม่อนุญาตในรอบนี้ (เช่น PARTICIPATION ในรอบ Final)
    # เก็บไว้เพื่อบอกแอดมินได้ตรงจุดว่าผิดเพราะอะไร แทนที่จะบอกแค่ "ไม่รู้จัก"
    excluded: tuple[AwardDef, ...] = ()

    def get(self, code: str | None) -> AwardDef | None:
        return next((a for a in self.awards if a.code == code), None)

    def resolve_folder(self, name: str) -> AwardDef | None:
        """ชื่อโฟลเดอร์ -> รางวัล ต้องตรงกับชื่อที่ประกาศไว้เท่านั้น ไม่เดา"""
        key = folder_key(name)
        return next((a for a in self.awards if key in a.folders), None) if key else None

    def excluded_folder(self, name: str) -> AwardDef | None:
        key = folder_key(name)
        return next((a for a in self.excluded if key in a.folders), None) if key else None

    def resolve_text(self, text: str | None) -> AwardDef | None:
        """ข้อความรางวัลบนหน้า/ในชีท -> รางวัล สำหรับตรวจทานเท่านั้น

        ห้ามใช้ผลนี้ตัดสินรางวัลของใบจริง — รางวัลมาจากโฟลเดอร์เสมอ
        """
        key = folder_key(text or "")
        if not key:
            return None
        for candidate in (key, _strip_noise(key)):
            found = next(
                (a for a in self.awards + self.excluded if candidate in a.folders or candidate in a.text),
                None,
            )
            if found:
                return found
        return None


def _strip_noise(key: str) -> str:
    tokens = key.split(" ")
    while tokens and tokens[-1] in TEXT_NOISE:
        tokens.pop()
    return " ".join(tokens)


@dataclass(frozen=True)
class ProgramManifest:
    program: str
    name: str
    profile_keys: dict[str, str]
    path_policies: dict[str, PathPolicy]
    awards: tuple[AwardDef, ...]


class Manifests:
    def __init__(self, programs: dict[str, ProgramManifest]) -> None:
        self.programs = programs

    def supported_pairs(self) -> list[tuple[str, str]]:
        return sorted((p, r) for p, m in self.programs.items() for r in m.profile_keys)

    def profile_key(self, program: str, exam_round: str) -> str | None:
        manifest = self.programs.get(program)
        return manifest.profile_keys.get(exam_round) if manifest else None

    def catalog(self, program: str, exam_round: str) -> AwardCatalog:
        manifest = self._require(program, exam_round)
        return AwardCatalog(
            program=program,
            round=exam_round,
            awards=tuple(a for a in manifest.awards if exam_round in a.rounds),
            excluded=tuple(a for a in manifest.awards if exam_round not in a.rounds),
        )

    def path_policy(self, program: str, exam_round: str) -> PathPolicy:
        return self._require(program, exam_round).path_policies[exam_round]

    def _require(self, program: str, exam_round: str) -> ProgramManifest:
        manifest = self.programs.get(program)
        if manifest is None or exam_round not in manifest.profile_keys:
            raise KeyError(f"ไม่มีแคตตาล็อกรางวัลของ {program} รอบ {exam_round}")
        return manifest


def profiles_dir() -> Path:
    """ที่อยู่ของไฟล์ JSON

    ใน container (ทั้ง dev และ production) อยู่ที่ /shared/certificate-profiles
    รันในเครื่องตรง ๆ ใช้ <repo>/shared/certificate-profiles
    """
    override = os.environ.get("CERTIFICATE_PROFILES_DIR")
    if override:
        return Path(override)
    in_container = Path("/shared/certificate-profiles")
    if in_container.is_dir():
        return in_container
    return Path(__file__).resolve().parents[4] / "shared" / "certificate-profiles"


@lru_cache(maxsize=1)
def load_manifests() -> Manifests:
    directory = profiles_dir()
    files = sorted(p for p in directory.glob("*.json") if not p.name.startswith("_"))
    if not files:
        raise RuntimeError(f"ไม่พบไฟล์แคตตาล็อกรางวัลที่ {directory}")

    programs: dict[str, ProgramManifest] = {}
    for path in files:
        manifest = parse_manifest(json.loads(path.read_text(encoding="utf-8")), path.name)
        if manifest.program in programs:
            raise ValueError(f"{path.name}: รายการสอบ {manifest.program} ถูกประกาศซ้ำ")
        programs[manifest.program] = manifest
    return Manifests(programs)


def parse_manifest(data: dict[str, Any], source: str = "manifest") -> ProgramManifest:
    """ตรวจรูปแบบไฟล์ให้ครบก่อนใช้ — ผิดตรงไหนบอกตรงนั้น"""

    def fail(message: str) -> ValueError:
        return ValueError(f"{source}: {message}")

    program = str(data.get("program") or "")
    if not program or program != program.upper():
        raise fail("ต้องมี program เป็นตัวพิมพ์ใหญ่")

    rounds = data.get("rounds") or {}
    if not rounds or not set(rounds) <= set(ROUNDS):
        raise fail(f"rounds ต้องเป็น {ROUNDS}")
    profile_keys: dict[str, str] = {}
    policies: dict[str, PathPolicy] = {}
    for exam_round, config in rounds.items():
        key = config.get("profileKey")
        if key != f"{program}_{exam_round}":
            raise fail(f"profileKey ของรอบ {exam_round} ต้องเป็น {program}_{exam_round}")
        profile_keys[exam_round] = key
        policies[exam_round] = PathPolicy(level_subfolder=bool(config.get("levelSubfolder")))

    awards: list[AwardDef] = []
    seen_codes: set[str] = set()
    seen_keys: dict[str, str] = {}
    for raw in data.get("awards") or []:
        code = str(raw.get("code") or "")
        if not code or code in seen_codes:
            raise fail(f"รหัสรางวัลว่างหรือซ้ำ: {code!r}")
        seen_codes.add(code)
        if raw.get("kind") not in KINDS:
            raise fail(f"{code}: kind ต้องเป็น {KINDS}")
        award_rounds = tuple(raw.get("rounds") or ())
        if not award_rounds or not set(award_rounds) <= set(profile_keys):
            raise fail(f"{code}: rounds ต้องเป็นรอบที่รายการนี้มี")

        folders = _keys(raw.get("folders") or [])
        text = _keys(raw.get("text") or [])
        if not folders:
            raise fail(f"{code}: ต้องมีชื่อโฟลเดอร์อย่างน้อย 1 ชื่อ")
        # ชื่อเดียวกันห้ามชี้ได้สองรางวัล ไม่งั้นโฟลเดอร์นั้นเป็นรางวัลไหนก็ได้ = เดา
        for key in (*folders, *text):
            owner = seen_keys.get(key)
            if owner and owner != code:
                raise fail(f"ชื่อ '{key}' ถูกใช้ทั้งใน {owner} และ {code}")
            seen_keys[key] = code

        awards.append(
            AwardDef(
                code=code,
                label=str(raw.get("label") or code),
                label_th=raw.get("labelTh") or None,
                kind=raw["kind"],
                rounds=award_rounds,
                folders=folders,
                text=text,
                order=int(raw.get("order", 999)),
                badge=str(raw.get("badge") or "neutral"),
            )
        )

    if not awards:
        raise fail("ต้องมีรางวัลอย่างน้อย 1 รายการ")
    return ProgramManifest(
        program=program,
        name=str(data.get("name") or program),
        profile_keys=profile_keys,
        path_policies=policies,
        awards=tuple(sorted(awards, key=lambda a: (a.order, a.code))),
    )


def _keys(values: list[str]) -> tuple[str, ...]:
    out: list[str] = []
    for value in values:
        key = folder_key(str(value))
        if key and key not in out:
            out.append(key)
    return tuple(out)
