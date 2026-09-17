# คู่มือแก้ปัญหา

## ผู้ปกครองบอกว่าค้นชื่อไม่เจอ

ไล่ตามลำดับนี้:

1. **batch เผยแพร่แล้วหรือยัง** — หน้าแอดมินต้องขึ้นสถานะ "เผยแพร่แล้ว"
   ถ้ายังไม่เผยแพร่ ผู้ใช้จะค้นไม่เจอแม้ข้อมูลจะถูกต้องครบ
2. **หน้านั้นจับคู่ได้ไหม** — เปิดหน้า batch ดูส่วน "หน้าที่ยังจับคู่ไม่ได้"
3. **ชื่อในระบบสะกดตรงกับที่ผู้ปกครองพิมพ์ไหม**
   ```sql
   SELECT name_th, name_en, name_th_normalized, name_en_normalized
   FROM students WHERE name_th_normalized LIKE '%สมชาย%';
   ```
   ถ้า normalized ว่างหรือหน้าตาแปลก แสดงว่ามีอักขระที่กฎ normalize จัดการไม่ได้

## งานค้างอยู่ที่ "กำลังประมวลผล" ไม่ขยับ

```sql
SELECT id, type, status, attempts, error, locked_at FROM jobs ORDER BY created_at DESC LIMIT 5;
```

- **status = QUEUED นาน** → worker ไม่ได้ทำงาน ดู `docker compose logs worker` หรือ log ของ Railway
- **status = RUNNING แต่ `locked_at` เก่ามาก** → worker ตายกลางทาง
  ปลดล็อกด้วยการสั่งให้กลับเข้าคิว:
  ```sql
  UPDATE jobs SET status = 'QUEUED', locked_at = NULL
  WHERE id = '<job id>' AND status = 'RUNNING';
  ```
- **status = FAILED** → อ่านคอลัมน์ `error` มี traceback เต็ม

## จับคู่ผิดคน (เรื่องด่วน)

1. **ยกเลิกการเผยแพร่ batch นั้นทันที** จากหน้าแอดมิน — หยุดไม่ให้โหลดต่อได้ก่อน
2. แก้ไฟล์ Excel ให้ถูก แล้วอัปโหลดใหม่ (ระบบจับคู่ใหม่ทับของเดิมให้เอง ไม่ต้องตัด PDF ใหม่)
3. ตรวจหน้าสรุปให้ตัวเลขตรงก่อนเผยแพร่อีกครั้ง

## ตัดหน้าแล้วได้จำนวนไม่ตรงกับไฟล์

ดูค่าในหน้าสรุปของ batch:

- `foreignSkipped` สูงผิดปกติ → regex ตรวจสัญชาติไม่ตรงกับไฟล์จริง
  ตั้ง env `NATIONALITY_PATTERN` ใหม่ (ดู `docs/pdf-parsing-notes.md`)
- `nameNotFound` สูง → วิธีหาชื่อไม่เข้ากับแบบฟอร์มนี้ ตั้ง `NAME_PATTERN`
- ทั้งสองค่าเป็น 0 แต่ `pagesSplit` ไม่ตรงกับจำนวนหน้าจริง → ไฟล์ PDF อาจเสียบางหน้า

## ผู้ใช้กดดาวน์โหลดแล้วได้ Access Denied

presigned URL มีอายุ 15 นาที ถ้าผู้ใช้เปิดหน้าค้างไว้นานแล้วค่อยกด ให้รีเฟรชหน้าใหม่
ถ้าเกิดกับทุกคนทันทีที่กด แปลว่า credential ของ R2 ผิดหรือหมดอายุ

## ต้องลบข้อมูลของ batch ทิ้งทั้งรอบ

```sql
-- certificates และ staging_pages ถูกลบตามด้วย ON DELETE CASCADE
DELETE FROM batches WHERE id = '<batch id>';
```
ไฟล์บน R2 **ไม่ถูกลบตาม** ต้องลบเองจาก Cloudflare dashboard ที่ prefix
`certificates/<batch id>/`, `previews/<batch id>/` และ `sources/<batch id>/`

## ตรวจว่าระบบยังรับโหลดได้ไหม

```bash
BASE_URL=https://<โดเมนจริง> k6 run scripts/loadtest.js
```
เกณฑ์ผ่าน: p95 < 500ms, error rate < 1%
ถ้าไม่ผ่าน จุดแรกที่ต้องดูคือ index trigram บนตาราง `students` ยังอยู่ครบไหม:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'students';
```
