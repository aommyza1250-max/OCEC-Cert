# โครงสร้างฐานข้อมูลปัจจุบัน

ปรับปรุง 1 ตุลาคม 2569 แหล่งความจริงคือ `apps/web/prisma/schema.prisma`

## ตาราง

| ตาราง | หน้าที่ |
|---|---|
| `exam_programs` | รายการสอบ รหัส ชื่อ และสถานะเปิดใช้งาน |
| `exams` | รายการสอบหนึ่งรอบในปี ค.ศ. unique `(programId, round, year)` |
| `students` | ตัวคนที่รวมใบข้ามรายการและปี |
| `batches` | รอบนำเข้ารองรับหลายไฟล์และหลายครั้ง มี profile รายชื่อที่ใช้งาน และนโยบายรางวัล |
| `roster_imports` | การอัป Excel และสถานะร่าง |
| `roster_import_rows` | แถวร่าง unique `(importId, candidateNo)` |
| `roster_entries` | ผู้เข้าสอบในรอบ จาก Excel หรือเพิ่มเอง เก็บ ONLINE/ONSITE และการผูกตัวคน |
| `staging_pages` | หน้า PDF หลักฐานต้นทาง ผลอ่าน ปัญหาจับคู่ การตัดสิน fingerprint |
| `certificates` | ใบที่ผูกกับตัวคนและ roster ใช้เผยแพร่และกำหนดอายุไฟล์ |
| `jobs` | คิว worker attempts progress และ error |
| `audit_events` | ประวัติการแก้ไขและการปิดปรับปรุง |
| `site_settings` | สถานะปิดปรับปรุง แถว `id=1` |
| `deleted_batches` | หลักฐานสรุปรอบที่ลบ |

`RosterEntry` คือการสอบของคนในรอบ ส่วน `Student` คือตัวคนข้ามรอบ ห้ามยืนยันว่าเป็นคนเดียวกันจากชื่อเพียงอย่างเดียว เมื่อแยกไม่ได้ส่งแอดมิน ไม่สร้างคนใหม่เพื่อหนีปัญหา

## คีย์ป้องกันข้อมูลซ้ำ

- RosterEntry unique `(batchId, candidateNo)` เลขไม่ซ้ำทั้ง Online และ Onsite
- Certificate unique `(examId, studentId, award)` และ `(rosterEntryId, award)` คนมีหลายใบได้ถ้าคนละรางวัล
- StagingPage unique `(batchId, pageNumber)` และมี index รอบกับเลข / fingerprint
- UUID สร้างจากโค้ด Prisma ใช้ `@default(uuid())`; Python ต้องเรียก `new_id()` ทุก INSERT

## รางวัลและหลักฐาน

`award` เป็นรหัสจาก `shared/certificate-profiles/` ไม่จำกัดห้ารางวัล BBB มี `1ST_PRIZE` และมี `PARTICIPATION` / `SPECIAL_AWARD` ตามรายการและรอบ

StagingPage.award เก็บรางวัลต้นทางห้ามแก้ การเปลี่ยนรางวัลเขียน `awardOverride` พร้อม audit Certificate.award ต้องมีค่า และมี awardLabel / awardLabelTh เก็บชื่อรางวัลเมื่อออกใบ โหมดจากโฟลเดอร์หรือ roster เก็บหลักฐานที่มา

## การเผยแพร่และอายุไฟล์

แก้ข้อมูลไม่ได้ขณะ batch เป็น PUBLISHED เผยแพร่เฉพาะคนที่พร้อม การค้นหาตรวจ published_at, expires_at และ files_deleted_at การตั้งวันหมดอายุกับการลบไฟล์จริงเป็นคนละขั้น ต้องเปิด RETENTION_ENABLED ที่ worker จึงลบจริง

site_settings.maintenance_enabled ถูกอ่านเมื่อค้นหาและออกลิงก์ไฟล์ สลับสถานะและ audit ใน transaction เดียวกัน

## Index ค้นหา

ประกาศ GIN trigram ของ nameEnNormalized และ nameThNormalized พร้อม gin_trgm_ops ใน **schema.prisma เท่านั้น** ค้นอังกฤษแบบ contains ของค่าที่ normalize แล้ว เป็น substring ไม่ใช่ fuzzy แก้สะกดผิด

ห้ามเพิ่ม index ด้วย raw SQL อย่างเดียว Prisma อาจสร้าง migration ลบเพราะ drift แก้ schema แล้ว generate client และรีสตาร์ท dev server เสมอ

## สถานะ

BatchStatus: DRAFT SPLITTING MATCHING READY PUBLISHED FAILED DELETING; SPLIT_DONE คงไว้สำหรับข้อมูลระบบเดิม

MatchStatus: UNMATCHED MATCHED AMBIGUOUS DUPLICATE_NAME NAME_MISMATCH MODE_MISMATCH NATIONALITY_UNVERIFIED PARSE_REVIEW SKIPPED_FOREIGN DISCARDED

ดู `data-intake-spec.md` และ `admin-guide.md` สำหรับขั้นตอนและกฎการเปลี่ยนสถานะ
