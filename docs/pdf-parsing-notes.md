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
3. **ชื่อเป็นอังกฤษพิมพ์ใหญ่ล้วนเสมอ** — ใช้ `[A-Z][A-Z .'\-]+` ตรวจว่าหยิบถูกบรรทัด
   ถ้าไม่เข้ารูปแบบให้คืน `None` ดีกว่าคืนค่าผิด เพราะชื่อผิด = จับคู่ผิดคน
4. **`Cert No` คือเลขเดียวกับ `CANDIDATE NO` ใน Excel** (ตรวจแล้ว 242/242)
   จึงใช้เป็นคีย์จับคู่หลักได้ — ดู `docs/data-intake-spec.md` ข้อ 2
5. **หน้า Perfect Score ใช้เทมเพลตคนละแบบ** ไม่มีบรรทัดรางวัล ไม่มีบรรทัดภาษาจีน
   และสลับลำดับลายเซ็น (`Dr. Andy Lam` มาก่อน) — รางวัลจึงต้องมาจากชื่อโฟลเดอร์ใน ZIP เท่านั้น

---

## ค่าตั้งต้นที่ใช้อยู่ (ปรับผ่าน environment ได้ทุกตัว)

| ตัวแปร | ค่าตั้งต้น | ใช้หาอะไร |
|---|---|---|
| `NAME_ANCHOR` | `This is awarded to` | บรรทัดก่อนชื่อ |
| `COUNTRY_LINE_PREFIX` | `from ` | บรรทัดสัญชาติ (ชื่ออยู่บรรทัดก่อนหน้า) |
| `NATIONALITY_PATTERN` | `from\s+THAILAND` | ใช้กรองคนไทยในรอบ Final |
| `LEVEL_LINE_PREFIX` | `for outstanding achievement in` | ระดับชั้น |
| `CERT_NO_PATTERN` | `(?:Cert\s+)?No:\s*(\d+)` | เลขผู้เข้าสอบ |
| `AWARD_LINE_PATTERN` | `^(.+?)\s+Award$` | รางวัลบนหน้า (ใช้ตรวจทานกับโฟลเดอร์) |
| `ROUND_YEAR_PATTERN` | `(Final\|Heat)\s+Round\s+(\d{4})` | รอบและปี ค.ศ. |
| `NAME_VALIDATION_PATTERN` | `[A-Z][A-Z .'\-]+` | ตรวจว่าหยิบถูกบรรทัด |
| `NAME_PATTERN` | (ว่าง) | ใส่ regex ที่มี capture group เดียวเพื่อข้ามตรรกะ anchor ทั้งหมด |

---

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
