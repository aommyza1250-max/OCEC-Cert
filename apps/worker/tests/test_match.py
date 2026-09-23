"""เทสตรรกะการตัดสินใจจับคู่และการระบุตัวคน — ส่วนที่ไม่แตะฐานข้อมูล

ทั้งสายงานที่แตะฐานข้อมูลจริงอยู่ใน tests/test_intake_flow.py
"""

from app.tasks.match import Entry, Page, StudentRow, decide, manual_snapshot, resolve_identities


def entry(no="900101", name="SOMCHAI JAIDEE", mode="ONLINE", id=None, **extra) -> Entry:
    return Entry(id=id or f"e{no}", candidate_no=no, names=frozenset({name}), exam_mode=mode, **extra)


def page(no="900101", name="SOMCHAI JAIDEE", mode="ONLINE", award="GOLD", n=1, **extra) -> Page:
    return Page(id=f"p{n}", page_number=n, cert_no=no, name_normalized=name, exam_mode=mode,
                award=award, **extra)


def one(pages, entries, **kw):
    result = decide(pages, entries, **kw)
    return result[pages[0].id]


# ---------------------------------------------------------------- จับคู่


def test_เลข_ชื่อ_และรูปแบบตรงกัน_จับคู่ได้():
    d = one([page()], [entry()])
    assert (d.status, d.entry_id, d.how) == ("MATCHED", "e900101", "number")


def test_เลขตรงแต่ชื่อไม่ตรง():
    d = one([page(name="PIYADA SRISUK")], [entry()])
    assert (d.status, d.entry_id) == ("NAME_MISMATCH", "e900101")


def test_เลขและชื่อตรงแต่รูปแบบการสอบไม่ตรง():
    d = one([page(mode="ONSITE")], [entry(mode="ONLINE")])
    assert (d.status, d.entry_id) == ("MODE_MISMATCH", "e900101")
    assert "onsite" in d.note and "online" in d.note


def test_ชื่อไม่ตรงมาก่อนรูปแบบไม่ตรง_แยกสถานะกันชัด():
    d = one([page(name="PIYADA SRISUK", mode="ONSITE")], [entry()])
    assert d.status == "NAME_MISMATCH"


def test_แอดมินยืนยันใช้รูปแบบตามรายชื่อแล้ว_จับคู่ได้():
    d = one([page(mode="ONSITE", mode_confirmed_for="ONLINE")], [entry(mode="ONLINE")])
    assert d.status == "MATCHED"


def test_การยืนยันรูปแบบใช้ไม่ได้ถ้ารายชื่อเปลี่ยนรูปแบบ():
    # ยืนยันไว้ว่าใช้ ONSITE ตามรายชื่อ แต่รายชื่อเปลี่ยนเป็น ONLINE แล้ว หน้านี้อยู่โฟลเดอร์ ONLINE พอดี
    d = one([page(mode="ONLINE", mode_confirmed_for="ONSITE")], [entry(mode="ONLINE")])
    assert d.status == "MATCHED"
    d = one([page(mode="ONLINE", mode_confirmed_for="ONLINE")], [entry(mode="ONSITE")])
    assert d.status == "MODE_MISMATCH"


def test_เลขที่ไม่มีในรายชื่อ_ไม่ถอยไปใช้ชื่อ():
    d = one([page(no="999")], [entry()])
    assert d.status == "UNMATCHED"
    assert "999" in d.note


def test_อ่านเลขไม่ได้_ใช้ชื่อกับรูปแบบการสอบ_ต้องตรงคนเดียว():
    d = one([page(no=None)], [entry()])
    assert (d.status, d.how) == ("MATCHED", "name")


def test_อ่านเลขไม่ได้_ชื่อตรงหลายคน_ไม่เลือกให้():
    entries = [entry("1"), entry("2")]
    d = one([page(no=None)], entries)
    assert d.status == "AMBIGUOUS"
    assert d.review["candidateEntryIds"] == ["e1", "e2"]


def test_อ่านเลขไม่ได้_ชื่อตรงแต่คนละรูปแบบการสอบ_ไม่นับ():
    entries = [entry("1", mode="ONLINE"), entry("2", mode="ONSITE")]
    d = one([page(no=None, mode="ONSITE")], entries)
    assert (d.status, d.entry_id) == ("MATCHED", "e2")


def test_หน้าที่อ่านชื่อไม่ออก_เชื่อเลข():
    d = one([page(name=None)], [entry()])
    assert d.status == "MATCHED"


def test_คนเดียวหลายรางวัลได้_รางวัลเดียวกันซ้ำไม่ได้():
    pages = [page(award="GOLD", n=1), page(award="PERFECT_SCORE", n=2), page(award="GOLD", n=3)]
    result = decide(pages, [entry()])
    assert [result[p.id].status for p in pages] == ["MATCHED", "MATCHED", "DUPLICATE_NAME"]
    assert result["p3"].review["acceptedPageId"] == "p1"


def test_รหัสรางวัลของรายการคงเดิม_1ST_PRIZE_ไม่ชนกับ_GOLD():
    pages = [page(award="1ST_PRIZE", n=1), page(award="GOLD", n=2)]
    result = decide(pages, [entry()])
    assert [result[p.id].status for p in pages] == ["MATCHED", "MATCHED"]


def test_หน้าเนื้อหาเดียวกันต่างรางวัล_ส่งให้แอดมินดู():
    pages = [page(award="GOLD", n=1, fingerprint="x"), page(award="SILVER", n=2, fingerprint="x")]
    result = decide(pages, [entry()])
    assert result["p2"].status == "DUPLICATE_NAME"


def test_หน้าที่ผูกด้วยมือได้สิทธิ์ก่อน():
    e = entry()
    manual = page(n=5, no=None, name=None, manual_match=manual_snapshot(e))
    auto = page(n=1)
    result = decide([auto, manual], [e])
    assert result["p5"].status == "MATCHED"
    assert result["p1"].status == "DUPLICATE_NAME"


def test_ผูกด้วยมือแล้วรายชื่อเปลี่ยน_ต้องกลับไปตรวจใหม่():
    old = entry(name="SOMCHAI JAIDEE")
    renamed = entry(name="SOMCHAI JAIDEEE")
    d = one([page(no=None, name="X Y", manual_match=manual_snapshot(old))], [renamed])
    assert d.keep_manual is False
    assert d.status == "UNMATCHED"
    assert "ด้วยมือ" in d.note


def test_ผูกด้วยมือยังข้ามการตรวจชื่อ_แต่ไม่ข้ามการตรวจรูปแบบ():
    e = entry(mode="ONLINE")
    d = one([page(name="NICKNAME ONLY", mode="ONSITE", manual_match=manual_snapshot(e))], [e])
    assert d.status == "MODE_MISMATCH"


def test_รอบ_Heat_โรงเรียนไม่ตรงเป็นแค่ข้อสังเกต():
    e = entry(school="Sample School", school_normalized="SAMPLE")
    d = one([page(school_on_page="OTHER SCHOOL")], [e], school_is_on_page=True)
    assert d.status == "MATCHED"
    assert "โรงเรียน" in d.review["warnings"][0]


def test_รายชื่อไม่มีโรงเรียน_ไม่เตือน_และไม่คัดลอกให้():
    d = one([page(school_on_page="OTHER SCHOOL")], [entry()], school_is_on_page=True)
    assert d.status == "MATCHED"
    assert "warnings" not in d.review


# ---------------------------------------------------------------- ระบุตัวคน


def student(id, name="SOMCHAI JAIDEE", school=None) -> StudentRow:
    return StudentRow(id=id, name_en_normalized=name, name_th_normalized=None, school_normalized=school)


def test_ไม่มีใครชื่อนี้_สร้างคนใหม่():
    assert resolve_identities([entry()], [entry()], [])["e900101"].kind == "NEW"


def test_ชื่อตรงคนเดียว_ผูกกับคนเดิม():
    result = resolve_identities([entry()], [entry()], [student("s1")])
    assert (result["e900101"].kind, result["e900101"].student_id) == ("LINK", "s1")


def test_ชื่อพ้องหลายคน_แยกด้วยโรงเรียนไม่ได้_ห้ามสร้างคนใหม่():
    result = resolve_identities([entry()], [entry()], [student("s1", school="A"), student("s2", school="B")])
    assert result["e900101"].kind == "AMBIGUOUS"
    assert result["e900101"].candidates == ("s1", "s2")


def test_แยกด้วยโรงเรียนได้():
    e = entry(school_normalized="B")
    result = resolve_identities([e], [e], [student("s1", school="A"), student("s2", school="B")])
    assert result[e.id].student_id == "s2"


def test_คนละโรงเรียนกับทุกคนที่ชื่อนี้_เป็นคนใหม่():
    e = entry(school_normalized="C")
    result = resolve_identities([e], [e], [student("s1", school="A")])
    assert result[e.id].kind == "NEW"


def test_สองคนในรอบเดียวกันชื่อเดียวกัน_แย่งตัวคนเดิมคนเดียว_ห้ามเดาว่าใครใช่():
    a, b = entry("1"), entry("2")
    result = resolve_identities([a, b], [a, b], [student("s1")])
    assert result[a.id].kind == "AMBIGUOUS"
    assert result[b.id].kind == "AMBIGUOUS"


def test_สองคนในรอบเดียวกันชื่อเดียวกัน_ไม่มีคนเดิม_สร้างใหม่ทั้งคู่():
    a, b = entry("1"), entry("2")
    result = resolve_identities([a, b], [a, b], [])
    assert result[a.id].kind == result[b.id].kind == "NEW"


def test_ตัวคนที่ผูกกับอีกคนในรอบเดียวกันแล้ว_ห้ามผูกซ้ำ():
    linked = entry("1", student_id="s1")
    fresh = entry("2")
    result = resolve_identities([fresh], [linked, fresh], [student("s1")])
    assert result[fresh.id].kind == "NEW"
