# บันทึกการอ่านข้อความจากไฟล์เกียรติบัตร

> **สถานะ: ยืนยันกับไฟล์จริงแล้ว** — ชุด HKIMO Final 2026 จำนวน 242 หน้า อ่านได้ครบทุกค่า
> ตรวจซ้ำได้ตลอดด้วย `docker compose exec worker python scripts/check_real_files.py`

---

## โครงข้อความในหน้าเกียรติบัตร HKIMO

นี่คือลำดับบรรทัดที่ `page.get_text("text")` คืนออกมาจริง (ตัดตัวอักษรหัวเรื่องออกแล้ว):

```
Tangent Wong                                            ← ลายเซ็นกรรมการ มาก่อนเนื้อหา
Director
Andy Lam
President
H · O · N · G · ...                                     ← ชื่องาน แตกเป็นบรรทัดละตัวอักษร
香港國際數學競賽總決賽
Gold Award                                              ← รางวัล (Perfect Score ไม่มีบรรทัดนี้)
This is awarded to                                      ← anchor
SOMCHAI JAIDEE                                ← ชื่อผู้รับ
from THAILAND                                           ← สัญชาติ
for outstanding achievement in PRIMARY 3,               ← ระดับชั้น (มีจุลภาคท้าย)
Hong Kong International Mathematical Olympiad Final Round 2026,   ← รอบ + ปี ค.ศ.
22nd - 23rd August 2026, Hong Kong & worldwide
Cert No: 900101                                         ← เลขผู้เข้าสอบ
23rd Aug 2026
```

### สิ่งที่โครงนี้บอก

1. **ห้ามใช้วิธี "หาบรรทัดที่ฟอนต์ใหญ่ที่สุด"** — ชื่องานถูกแตกเป็นบรรทัดละตัวอักษร
   และลายเซ็นกรรมการมาก่อนเนื้อหาจริง วิธีเดียวที่ได้ผลคืออ้างจากข้อความหลัก (anchor)
2. **ชื่อหาได้ 2 ทาง** ซึ่งได้ผลตรงกันทั้ง 242 หน้า
   - บรรทัด **ก่อน** บรรทัดที่ขึ้นต้นด้วย `from `
   - บรรทัด **ถัดจาก** `This is awarded to`
3. **ชื่อในตัวอย่างชุดนี้เป็นอังกฤษพิมพ์ใหญ่** — ใช้ `[A-Z][A-Z .'\-]+` ตรวจว่าหยิบถูกบรรทัด
   ถ้าไม่เข้ารูปแบบให้คืน `None` ดีกว่าคืนค่าผิด เพราะชื่อผิด = จับคู่ผิดคน
4. **`Cert No` คือเลขเดียวกับ `CANDIDATE NO` ใน Excel** (ตรวจแล้ว 242/242)
   จึงใช้เป็นคีย์จับคู่หลักได้ — ดู `docs/data-intake-spec.md` ข้อ 2
5. **หน้า Perfect Score ใช้เทมเพลตคนละแบบ** ไม่มีบรรทัดรางวัล ไม่มีบรรทัดภาษาจีน
   และสลับลำดับลายเซ็น (`Dr. Andy Lam` มาก่อน) — รางวัลจึงต้องมาจากชื่อโฟลเดอร์ใน ZIP เท่านั้น

---

## การตั้งกฎอ่านในระบบปัจจุบัน

กฎ parser อยู่ในโปรไฟล์ Python รายรายการและรอบที่ `apps/worker/app/certificate_profiles/` ไม่มี env กลาง NAME_ANCHOR, COUNTRY_LINE_PREFIX, NATIONALITY_PATTERN, LEVEL_LINE_PREFIX, CERT_NO_PATTERN, AWARD_LINE_PATTERN, ROUND_YEAR_PATTERN, NAME_VALIDATION_PATTERN หรือ NAME_PATTERN ที่ใช้เปลี่ยน parser แล้ว

ใช้เมธอด extract_name, extract_candidate_no, extract_level, extract_from, extract_round_year, extract_award_text และ extract_extra โดย override เฉพาะส่วนต่างของรายการ ดู [certificate-profiles.md](certificate-profiles.md)

ตัวอย่าง HKIMO ด้านบนเป็นผลสำรวจเฉพาะชุดเดิม ไม่ใช่โครงทุกใบ BBB ไม่มี anchor แบบเดียวกัน Heat ใช้ from เป็นโรงเรียน Final เป็นประเทศ ขาดหลักฐานประเทศต้องค้าง NATIONALITY_UNVERIFIED ไม่เดาเป็นไทย

รูป WebP สำหรับดูและดาวน์โหลดใช้ `CERT_IMAGE_DPI=150` และ `CERT_IMAGE_QUALITY=85`
ส่วน `PREVIEW_DPI=72` กับ `PREVIEW_QUALITY=75` ใช้เฉพาะสคริปต์สร้าง preview รุ่นเก่าของหน้าที่ยังจับคู่ไม่ได้

## วิธีสำรวจไฟล์ของรายการสอบใหม่

วางไฟล์ไว้ที่ `apps/worker/tmp/<รายการสอบ>/<รางวัล>/*.pdf` แล้วรัน:

```bash
docker compose exec worker python scripts/check_real_files.py
```

สคริปต์จะรายงานว่าอ่านชื่อ/เลข/ระดับชั้น/ปี/รางวัลได้กี่เปอร์เซ็นต์ และถ้ามีไฟล์ `.xlsx`
อยู่ใน `tmp/` ด้วย จะเทียบเลขกับชื่อให้อัตโนมัติ

ถ้าอยากดูข้อความดิบของหน้าใดหน้าหนึ่ง:

```bash
docker compose exec worker python - <<'PY'
import pymupdf, re
doc = pymupdf.open("/app/tmp/<โฟลเดอร์>/<ไฟล์>.pdf")
lines = [re.sub(r"\s+", " ", l).strip() for l in doc[0].get_text("text").splitlines() if l.strip()]
print([l for l in lines if len(l) > 1])   # ตัดตัวอักษรเดี่ยวของหัวเรื่องออก
PY
```

**ห้าม commit ไฟล์จริงเข้า git** — `apps/worker/tmp/` ถูก gitignore ไว้แล้ว

---

## สิ่งที่ต้องตรวจเมื่อรับไฟล์ของรายการสอบใหม่

- [ ] ข้อความ anchor ยังเป็น `This is awarded to` ไหม
- [ ] บรรทัดสัญชาติยังขึ้นต้นด้วย `from ` ไหม
- [ ] เลขยังเขียนว่า `Cert No:` ไหม และตรงกับคอลัมน์ไหนใน Excel
- [ ] บรรทัดรอบยังเขียน `Final Round 2026` / `Heat Round 2026` ไหม
- [ ] ชื่อโฟลเดอร์รางวัลสะกดแบบไหน (`normalize_award` รองรับหรือยัง)
- [ ] มีเทมเพลตพิเศษที่ไม่มีบรรทัดรางวัลเหมือน Perfect Score อีกไหม
- [ ] ภาษาไทยบนหน้า (ถ้ามี) เรนเดอร์ preview ออกมาถูกต้องไหม
