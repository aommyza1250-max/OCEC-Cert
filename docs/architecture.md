# สถาปัตยกรรมระบบปัจจุบัน

ปรับปรุง 1 ตุลาคม 2569 อ้างอิง apps/web และ apps/worker

## ส่วนประกอบ

```text
ผู้ใช้ → web Next.js → PostgreSQL
แอดมิน → web ออก presigned PUT → เบราว์เซอร์อัปตรง R2
web → jobs ใน PostgreSQL → worker poll / wake
worker → ดาวน์โหลด ZIP ลงดิสก์ → อ่าน PDF ทีละไฟล์ → R2 และฐานข้อมูล
ผู้ใช้ → web ออก presigned GET → redirect ไป R2
รูปตัวอย่าง → preview endpoint → เฉพาะ previews/ ใน R2
```

web ทำหน้าค้นหา หลังบ้าน ออกลิงก์ไฟล์ และบันทึกการตัดสิน worker ทำ Excel draft/activate ตัด PDF จับคู่ สร้าง WebP ล้าง ZIP กวาดอายุ และลบรอบ คิวอยู่ใน Postgres ใช้ล็อกงานและป้องกันงานในรอบเดียวกันรันพร้อมกัน

ไฟล์ขนาดใหญ่ไม่ผ่าน Next.js API อัปด้วย presigned PUT จาก browser ไป R2 ดาวน์โหลด redirect ด้วย presigned GET ปริยาย 900 วินาที worker อัป PDF/preview ไป R2 เป็น network egress ของ Railway แม้ผู้ใช้โหลดออกจาก R2 ฟรี

## ลำดับนำเข้าปัจจุบัน

1. สร้างรอบรายการสอบ + Heat/Final + ปี ค.ศ. มีทั้ง Online และ Onsite ในรอบเดียว
2. อัป Excel ตรวจทั้งไฟล์ สร้างร่าง ตรวจรายการชน แล้วให้แอดมินกดใช้รายชื่อ
3. อัป ZIP แบบรางวัลอย่างเดียวหรือโหมด/รางวัล ห้ามปนใน ZIP เดียวกัน
4. ตรวจโครงทั้ง ZIP แล้วอ่านด้วยโปรไฟล์ของรายการและรอบ รางวัลจากโฟลเดอร์เท่านั้น
5. เทียบ Cert No กับ roster และตรวจชื่อ/โหมด สัญชาติ รอบ ปี ไม่ชัดต้องค้างให้ตัดสิน
6. ตรวจไฟล์ขาดและรางวัลหลัก ยืนยันชุดเสริมรายคนหากต้นทางส่งเฉพาะเสริม
7. เผยแพร่คนที่พร้อม ค้างคนมีปัญหาไว้ ผู้ใช้ค้นเจอเฉพาะใบเผยแพร่ที่ไม่หมดอายุ/ไม่ลบไฟล์

แก้ไขไม่ได้ขณะเผยแพร่ ต้องยกเลิกก่อน รายชื่อ ไฟล์ รางวัล ตัวคน และการปิดปรับปรุงมี audit มี version กันสองแท็บทับกัน

## ความปลอดภัยและข้อมูล

- web เปิด public domain worker ใช้ private network ไม่เปิด public domain
- preview endpoint เปิดเฉพาะ previews/ ไม่เปิด certificates/ หรือ sources/ ทั้ง bucket
- โหมดปิดปรับปรุงหยุดค้นและออกลิงก์ใหม่ ไม่หยุด worker ลิงก์เก่ายังใช้ได้ถึงหมดอายุ
- Rate limit ปัจจุบัน 300 search และ 10 login ต่อ IP/นาที ค่าว่างใช้ default, 0 ปิด ใช้ x-real-ip จาก proxy ตัวนับใน memory จึงต้องออกแบบใหม่ก่อนเพิ่มหลาย web replicas
- ชื่อเหมือนกันไม่เท่ากับคนเดียวกัน ห้ามเดาสร้างตัวคนใหม่เพื่อหลบความกำกวม
- schema.prisma เป็นที่ประกาศ index และ Prisma client UUID Python สร้าง new_id() เอง

## ไฟล์และอายุข้อมูล

เกียรติบัตร PDF, preview WebP, ZIP/Excel ต้นทางอยู่ R2 แยก prefix ตาม batch/job ค่าปริยาย preview 72 DPI คุณภาพ 75 ZIP ล้างหลังเผยแพร่และครบเงื่อนไขตาม cleanup_sources.py ยังไม่ล้างเมื่อมีคนขาดใบหลัก

วันหมดอายุปริยาย 24 เดือนจากการเผยแพร่ครั้งแรก การลบจริงปิดโดย default RETENTION_ENABLED=false ยังต้องมี backup ทั้ง PostgreSQL และ R2 โดยเฉพาะก่อนลบรอบหรือ reimport

## การ deploy

production ที่ตรวจ 1 ตุลาคม 2569 ใช้ Dockerfile ผ่าน Railway Settings จาก repo ลูกค้า branch main บริการ web/worker ตั้ง On Failure 10 retries ไม่ได้ผูกไฟล์ infra/railway.*.json ซึ่งระบุ 3 retries

Config as Code เดิมถูกเลิกใช้สำหรับ service ใหม่ ไฟล์เดิมใช้ได้ถึง 1 ธันวาคม 2569 ตาม [ประกาศ Railway](https://docs.railway.com/config-as-code) ใช้ Settings หรือวางแผน Infrastructure as Code โดยตรวจ diff ก่อน apply

ค่าใช้จ่ายและกำลังรองรับเป็นผลของทรัพยากรและรูปแบบ traffic ไม่ใช่ค่าคงที่หรือการรับรองจากจำนวนผู้ใช้ต่อเดือน ดู capacity-and-cost.md
