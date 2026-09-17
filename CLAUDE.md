# OCEC-Cert — บันทึกสำหรับผู้ร่วมพัฒนา

ระบบค้นหาและดาวน์โหลดเกียรติบัตร + ระบบนำเข้าอัตโนมัติ
ภาพรวมระบบอยู่ใน `README.md` รายละเอียดเชิงลึกอยู่ใน `docs/`

## โครงสร้าง

| ที่อยู่ | คืออะไร |
|---|---|
| `apps/web` | Next.js 15 (App Router) + Tailwind 4 + Prisma — หน้าค้นหาสาธารณะและหน้าแอดมิน |
| `apps/worker` | Python 3.12 + FastAPI + PyMuPDF — ตัด PDF, สร้าง preview, จับคู่ Excel |
| `shared/` | ไฟล์ที่ทั้งสองภาษาใช้ร่วมกัน (ตอนนี้มีเคสทดสอบ normalize) |
| `docs/` | สเปกและคู่มือ — เริ่มที่ `data-intake-spec.md` ถ้าจะแตะเรื่องการนำเข้า |
| `infra/` | ไฟล์ตั้งค่า Railway และ CORS ของ R2 |

## กฎที่ห้ามพลาด

1. **แก้ `normalize` ต้องแก้ทั้งสองภาษาเสมอ**
   `apps/web/src/lib/normalize.ts` กับ `apps/worker/app/normalize.py` ต้องให้ผลตรงกันทุกกรณี
   ครอบคลุม `normalizeName` / `normalizeSchool` / `normalizeAward`
   เคสทดสอบอยู่ที่ `shared/normalize-cases.json` ไฟล์เดียว อ่านโดยทั้ง vitest และ pytest
   ถ้าสองฝั่งเหลื่อมกัน การจับคู่จะพังแบบไม่มี error ให้เห็น
   สเปก: `docs/name-normalization.md`

2. **ห้าม commit ไฟล์เกียรติบัตรหรือรายชื่อจริง** — เป็นข้อมูลส่วนบุคคล
   ไฟล์ทดสอบสร้างขึ้นด้วยโค้ดที่ `apps/worker/tests/fixtures/builders.py`

3. **ไฟล์ขนาดใหญ่ต้องไม่วิ่งผ่านเซิร์ฟเวอร์เว็บ**
   อัปโหลดใช้ presigned PUT ตรงไป R2 ดาวน์โหลดใช้ presigned GET แล้ว redirect
   ถ้าเผลอให้ไฟล์ผ่าน Next.js API เซิร์ฟเวอร์บน Railway จะกินแรมจนถูกฆ่า

4. **ห้ามเดาเวลาจับคู่ไม่ชัด** — ตั้งเป็น `AMBIGUOUS` / `DUPLICATE_NAME` ให้คนตัดสิน
   จับคู่ผิด = ผู้ปกครองดาวน์โหลดเกียรติบัตรของคนอื่น
   **การสร้างผู้เข้าสอบคนใหม่ก็เป็นการเดาอย่างหนึ่ง** (เดาว่า "เป็นคนละคน")
   ถ้าชื่อพ้องกันหลายคนและแยกไม่ออก ห้ามสร้างใหม่ ให้ส่งแอดมิน
   ไม่งั้นรันจับคู่ซ้ำจะเกิดผู้เข้าสอบซ้ำซ้อนขึ้นเรื่อย ๆ โดยไม่มีอะไรฟ้อง

5. **รางวัลมาจากชื่อโฟลเดอร์ใน ZIP เท่านั้น** — ไม่ใช่จากข้อความบนหน้าหรือจาก Excel
   หน้า Perfect Score ไม่มีข้อความรางวัลพิมพ์อยู่เลย และ Excel บันทึกรางวัลสูงสุดแค่แถวเดียวต่อคน
   เจอโฟลเดอร์ที่แปลงเป็นรางวัลไม่ได้ ให้หยุดทั้งงาน ไม่ใช่เดาหรือข้าม

6. **ไฟล์ ZIP จริงมีขนาดหลายร้อย MB** — worker ต้องดาวน์โหลดลงดิสก์ และอ่าน PDF ทีละไฟล์
   ถ้าเผลออ่านทั้งหมดเข้าหน่วยความจำพร้อมกัน จะถูกฆ่าเพราะแรมไม่พอ

7. **แก้ schema.prisma แล้วต้องรีสตาร์ท `pnpm dev` เสมอ**
   `prisma generate` เขียน client ใหม่ลง node_modules แต่ dev server ที่รันอยู่ยังถือตัวเก่าในหน่วยความจำ
   อาการคือ field ใหม่อ่านได้เป็น `undefined` หรือหน้าเว็บ 500 ทั้งที่ schema ถูกแล้ว

8. **index ค้นหาต้องประกาศใน schema.prisma เท่านั้น**
   ถ้าไปสร้างด้วย raw SQL ในไฟล์ migration อย่างเดียว `prisma migrate dev` รอบถัดไปจะมองว่าเป็นส่วนเกิน
   แล้วสร้าง `DROP INDEX` ให้อัตโนมัติ — การค้นหาจะยังทำงานแต่ช้าลงมากโดยไม่มีอะไรฟ้อง

9. **UUID ต้องสร้างจากฝั่งโค้ด** — Prisma ใช้ `@default(uuid())` ซึ่งไม่ได้ตั้ง DEFAULT ไว้ที่ฐานข้อมูล
   ฝั่ง Python ต้องเรียก `new_id()` ทุกครั้งที่ INSERT

## คำสั่งที่ใช้บ่อย

```bash
./scripts/dev.sh                                   # ยกทุกอย่างขึ้น
cd apps/web && pnpm dev                            # เว็บ http://localhost:3000
cd apps/web && pnpm test                           # เทส normalize ฝั่ง TS
cd apps/web && pnpm db:seed                        # ใส่ข้อมูลตัวอย่าง
docker compose exec worker python -m pytest -q     # เทสฝั่ง Python
docker compose exec worker python scripts/e2e_demo.py       # ทดสอบทั้งสายงานด้วยไฟล์สังเคราะห์
docker compose exec worker python scripts/check_real_files.py  # ตรวจตัวอ่านกับไฟล์จริงใน apps/worker/tmp/
docker compose logs -f worker                      # ดู log worker
```

## บัญชี dev

- แอดมิน: รหัสผ่านอยู่ใน `.env` ที่ `ADMIN_PASSWORD`
- MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`)
