"""เทสการเติมไฟล์ที่ตกหล่นเข้ารอบนำเข้าเดิม

จุดที่พลาดแล้วเจ็บที่สุด: คนเดียวได้หลายใบคนละรางวัล
ของจริงเคยเจอว่าต้นทางส่งใบ Perfect Score มาให้ แต่ใบ Gold ของคนเดียวกันหายไป
พอทวงแล้วได้ใบ Gold ตามมา ถ้าตรวจซ้ำด้วยเลขผู้เข้าสอบอย่างเดียว
ใบ Gold จะถูกมองว่าซ้ำแล้วโดนทิ้ง ทั้งที่เป็นใบที่ต้องมี
"""

from app.tasks.extract import PageInfo
from app.tasks.split import ExistingState, _already_imported, _dedupe_key
from app.tasks.zip_bundle import Bundle


def state(*keys: tuple[str, str]) -> ExistingState:
    return ExistingState(max_page=10, stems=set(), keys=set(keys))


def info(name="SOMCHAI JAIDEE", cert_no="900101") -> PageInfo:
    return PageInfo(name=name, level="PRIMARY 3", cert_no=cert_no, country="THAILAND")


def bundle(award: str) -> Bundle:
    return Bundle(award=award, source_file=f"{award}/x.pdf")


def test_หน้าเดิมเลขเดิมรางวัลเดิมถือว่าซ้ำ():
    assert _already_imported(state(("900101", "GOLD")), info(), bundle("GOLD")) is True


def test_เลขเดิมแต่คนละรางวัลไม่ใช่ของซ้ำ():
    # A ได้ Perfect Score ไปแล้ว ใบ Gold ที่ตามมาทีหลังต้องเข้าได้
    existing = state(("900101", "PERFECT_SCORE"))
    assert _already_imported(existing, info(), bundle("GOLD")) is False


def test_รางวัลเดิมแต่คนละคนไม่ใช่ของซ้ำ():
    assert _already_imported(state(("900101", "GOLD")), info(cert_no="900102"), bundle("GOLD")) is False


def test_ไม่มีเลขให้ใช้ชื่อแทน():
    existing = state(("SOMCHAI JAIDEE", "GOLD"))
    assert _already_imported(existing, info(cert_no=None), bundle("GOLD")) is True


def test_ชื่อที่ยังไม่_normalize_ต้องเทียบได้():
    # ในฐานข้อมูลเก็บชื่อที่ normalize แล้ว ส่วนที่อ่านจากหน้ายังไม่ได้ normalize
    existing = state(("SOMCHAI JAIDEE", "MERIT"))
    assert _already_imported(existing, info(name="Mr. Somchai  Jaidee", cert_no=None),
                             bundle("MERIT")) is True


def test_อ่านไม่ได้ทั้งเลขและชื่อให้เติมเข้าไป():
    # บอกไม่ได้ว่าซ้ำหรือไม่ — เติมเข้าไปแล้วให้แอดมินเห็น ดีกว่าเผลอทิ้งใบที่ควรมี
    assert _dedupe_key(None, None, "GOLD") is None
    assert _already_imported(state(), info(name=None, cert_no=None), bundle("GOLD")) is False


def test_ไม่มีรางวัลก็ตัดสินไม่ได้():
    assert _dedupe_key("900101", "SOMCHAI JAIDEE", None) is None
