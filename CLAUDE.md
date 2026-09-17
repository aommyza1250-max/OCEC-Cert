# OCEC-Cert — บันทึกสำหรับผู้ร่วมพัฒนา

ระบบค้นหาและดาวน์โหลดเกียรติบัตร + ระบบนำเข้าอัตโนมัติ
ภาพรวมระบบอยู่ใน `README.md` รายละเอียดเชิงลึกอยู่ใน `docs/`

## โครงสร้าง

| ที่อยู่ | คืออะไร |
|---|---|
| `apps/web` | Next.js 15 (App Router) + Tailwind 4 + Prisma — หน้าค้นหาสาธารณะและหน้าแอดมิน |
| `apps/worker` | Python 3.12 + FastAPI + PyMuPDF — ตัด PDF, สร้าง preview, จับคู่ Excel |
| `shared/` | ไฟล์ที่ทั้งสองภาษาใช้ร่วมกัน (ตอนนี้มีเคสทดสอบ normalize) |
| `docs/` | สเปกและคู่มือ |
| `infra/` | ไฟล์ตั้งค่า Railway และ CORS ของ R2 |

## กฎที่ห้ามพลาด

1. **แก้ `normalize` ต้องแก้ทั้งสองภาษาเสมอ**
   `apps/web/src/lib/normalize.ts` กับ `apps/worker/app/normalize.py` ต้องให้ผลตรงกันทุกกรณี
   เคสทดสอบอยู่ที่ `shared/normalize-cases.json` ไฟล์เดียว อ่านโดยทั้ง vitest และ pytest
   ถ้าสองฝั่งเหลื่อมกัน การจับคู่จะพังแบบไม่มี error ให้เห็น
   สเปก: `docs/name-normalization.md`

2. **ห้าม commit ไฟล์เกียรติบัตรหรือรายชื่อจริง** — เป็นข้อมูลส่วนบุคคล
   ไฟล์ทดสอบสร้างขึ้นด้วยโค้ดที่ `apps/worker/tests/fixtures/builders.py`

3. **ไฟล์ขนาดใหญ่ต้องไม่วิ่งผ่านเซิร์ฟเวอร์เว็บ**
   อัปโหลดใช้ presigned PUT ตรงไป R2 ดาวน์โหลดใช้ presigned GET แล้ว redirect
   ถ้าเผลอให้ไฟล์ผ่าน Next.js API เซิร์ฟเวอร์บน Railway จะกินแรมจนถูกฆ่า

4. **ห้ามเดาเวลาจับคู่ไม่ชัด** — ชื่อตรงกับหลายหน้าให้ตั้งเป็น `AMBIGUOUS` ให้คนตัดสิน
   จับคู่ผิด = ผู้ปกครองดาวน์โหลดเกียรติบัตรของคนอื่น

5. **แก้ schema.prisma แล้วต้องรีสตาร์ท `pnpm dev` เสมอ**
   `prisma generate` เขียน client ใหม่ลง node_modules แต่ dev server ที่รันอยู่ยังถือตัวเก่าในหน่วยความจำ
   อาการคือ field ใหม่อ่านได้เป็น `undefined` หรือหน้าเว็บ 500 ทั้งที่ schema ถูกแล้ว

6. **index ค้นหาต้องประกาศใน schema.prisma เท่านั้น**
   ถ้าไปสร้างด้วย raw SQL ในไฟล์ migration อย่างเดียว `prisma migrate dev` รอบถัดไปจะมองว่าเป็นส่วนเกิน
   แล้วสร้าง `DROP INDEX` ให้อัตโนมัติ — การค้นหาจะยังทำงานแต่ช้าลงมากโดยไม่มีอะไรฟ้อง

7. **UUID ต้องสร้างจากฝั่งโค้ด** — Prisma ใช้ `@default(uuid())` ซึ่งไม่ได้ตั้ง DEFAULT ไว้ที่ฐานข้อมูล
   ฝั่ง Python ต้องเรียก `new_id()` ทุกครั้งที่ INSERT

## คำสั่งที่ใช้บ่อย

```bash
./scripts/dev.sh                                   # ยกทุกอย่างขึ้น
cd apps/web && pnpm dev                            # เว็บ http://localhost:3000
cd apps/web && pnpm test                           # เทส normalize ฝั่ง TS
cd apps/web && pnpm db:seed                        # ใส่ข้อมูลตัวอย่าง
docker compose exec worker python -m pytest -q     # เทสฝั่ง Python
docker compose exec worker python scripts/e2e_demo.py  # ทดสอบทั้งสายงานด้วยไฟล์สังเคราะห์
docker compose logs -f worker                      # ดู log worker
```

## บัญชี dev

- แอดมิน: รหัสผ่านอยู่ใน `.env` ที่ `ADMIN_PASSWORD`
- MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`)
