"""เทสกฎ normalize ชื่อ

เคสทั้งหมดมาจาก shared/normalize-cases.json ไฟล์เดียวกับที่ vitest ฝั่งเว็บใช้
ถ้าเทสนี้เขียวแต่ฝั่ง TypeScript แดง (หรือกลับกัน) = สองฝั่ง normalize ไม่ตรงกันแล้ว
"""

import json
import os
from pathlib import Path

import pytest

from app.normalize import name_sort_key, normalize_name, normalize_school

def _cases_file() -> Path:
    """ในเครื่อง = <repo>/shared/, ใน container ของ compose = /shared (ดู docker-compose.yml)"""
    override = os.environ.get("NORMALIZE_CASES_FILE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / "shared" / "normalize-cases.json"


CASES_FILE = _cases_file()
_DATA = json.loads(CASES_FILE.read_text(encoding="utf-8"))
CASES = _DATA["cases"]
SCHOOL_CASES = _DATA["schoolCases"]


@pytest.mark.parametrize("case", CASES, ids=[c["why"] for c in CASES])
def test_matches_shared_cases(case):
    assert normalize_name(case["input"]) == case["normalized"]
    assert name_sort_key(case["input"]) == case["sortKey"]


@pytest.mark.parametrize("case", SCHOOL_CASES, ids=[c["why"] for c in SCHOOL_CASES])
def test_school_matches_shared_cases(case):
    assert normalize_school(case["input"]) == case["normalized"]
