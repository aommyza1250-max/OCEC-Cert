# ตรวจรับก่อนเปิดใช้งาน

ปรับปรุง 1 ตุลาคม 2569 ใช้กับระบบรายชื่อก่อน ZIP ปัจจุบัน การทดสอบเขียนข้อมูลหรือโหลดจำนวนมากให้ทำใน environment แยกก่อน production

## 1. การตั้งค่าและสิทธิ์

- [ ] ตั้ง ADMIN_PASSWORD, SESSION_SECRET และ WORKER_SHARED_SECRET เป็นค่าลับที่เหมาะสม; shared secret ตรงกัน web/worker
- [ ] worker และ Postgres ใช้ private network; worker ไม่มี public domain
- [ ] R2 bucket ไม่เปิด public access ให้ certificates/ หรือ sources/; preview endpoint อนุญาตเฉพาะ previews/ ทดสอบด้วย key ที่มีอยู่จริง ไม่ใช้การได้ 404 ของ key ที่ไม่มีเป็นหลักฐานการป้องกัน
- [ ] CORS รองรับ presigned PUT จาก origin ที่ใช้จริง ดู [setup-cloudflare-r2.md](setup-cloudflare-r2.md)
- [ ] ตรวจ IP และ rate limit ใน staging ตาม [rate-limit-ip.md](rate-limit-ip.md) ค่า 0 คือปิดลิมิต; ค่าว่างใช้ค่าปริยาย; อย่าปิดลิมิต production เพื่อทดสอบโหลด
- [ ] ตรวจ repo ไม่มี `.env`, credential, PDF หรือรายชื่อจริงในไฟล์ที่จะ commit
- [ ] ตรวจ Railway Settings จริง; infra/*.json เป็นตัวอย่างเดิม ไม่ใช่หลักฐานว่าผูก config อยู่

## 2. การนำเข้าและความถูกต้อง

- [ ] เลือกรายการสอบ รอบ และปีให้ถูก อัป Excel ตรวจ draft แล้วกดใช้รายชื่อก่อน ZIP
- [ ] Candidate No เป็นตัวเลขและไม่ซ้ำทั้งไฟล์; Candidate Name และ Exam Mode ครบ
- [ ] ZIP ใช้ award-only หรือ mode/award ตาม profile; ไม่ผสมโครงสร้าง; รางวัลจากโฟลเดอร์เท่านั้น
- [ ] ตรวจยอด Online/Onsite, หน้าทั้งหมด และสถานะค้าง อ่านชื่อไม่ออก ชื่อพ้อง เลขไม่ตรง และรางวัลบนหน้าไม่ตรง
- [ ] Final รับเฉพาะ THAILAND; ต่างชาติข้าม; ไม่มีสัญชาติให้ตรวจ ไม่เดา
- [ ] สุ่มเปิด preview และ PDF เทียบชื่อ เลข ปี รอบ และรางวัลกับต้นฉบับ
- [ ] ตรวจคนได้หลายใบ และเลือกนโยบายรางวัลหลัก/เสริมตามหลักฐานต้นทาง; คนที่มีเพียงรางวัลเสริมต้องยืนยันรายคน
- [ ] ดูยอดคนพร้อมและคนค้างก่อนเผยแพร่; ค้นและดาวน์โหลดหลังเผยแพร่ คนค้างต้องไม่เผยแพร่โดยไม่ตั้งใจ

## 3. ผู้ใช้และการดูแล

- [ ] ทดสอบมือถือจริง: ค้นภาษาอังกฤษ >=3 ตัวอักษร เปิด preview บันทึกรูป ดาวน์โหลดและเปิด PDF
- [ ] ทดสอบไม่มีผลค้นหา ชื่อพ้อง และโหมดปิดปรับปรุง
- [ ] ประเมินโหลดช่วงพีคใน staging ตามงบและเป้าหมาย; 10,000 คนต่อเดือนไม่รับรองจำนวนคนพร้อมกัน ดู [capacity-and-cost.md](capacity-and-cost.md)
- [ ] ตรวจ index จาก schema.prisma: students_name_en_normalized_trgm_idx และ students_name_th_normalized_trgm_idx
- [ ] มี backup DB และ R2 ที่ตรวจความครบแล้ว และทดลอง restore ใน environment แยก
- [ ] เก็บ ZIP/Excel ต้นทางนอกระบบตามนโยบายองค์กร: SOURCE_ZIP_KEEP_DAYS=0 ล้าง ZIP หลังงานสำเร็จ ไม่รับรองว่าต้นฉบับยังอยู่ให้กู้คืน
- [ ] รับทราบค่า RETENTION_ENABLED จริงก่อนคาดหวังการล้างไฟล์อัตโนมัติ; สคริปต์ verify_expire และ verify_cleanup เป็นการทดสอบที่แก้ข้อมูล ห้ามรัน production เพื่อทดลอง
- [ ] ผู้รับมอบลองนำเข้าด้วยข้อมูลสังเคราะห์และทราบ [admin-guide.md](admin-guide.md), [runbook.md](runbook.md)
- [ ] ส่งมอบบัญชีและ secret ผ่านช่องทางควบคุมสิทธิ์ พร้อมผู้รับผิดชอบ billing และเหตุขัดข้อง
