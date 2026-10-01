# ชุดเอกสารส่งมอบ OCEC-Cert

จัดทำ 1 ตุลาคม 2569 จากโค้ด checkout c5db3f9 และหน้าเว็บ/Railway ที่ตรวจจริง (SHA นี้ไม่ใช่การยืนยัน SHA ที่ production deploy)

เอกสาร Word/PDF อยู่ใน `tmp/handover/final/`:

- OCEC_User_Manual: ผู้ใช้ทั่วไปและแอดมิน พร้อมภาพจากหน้าเว็บจริง
- OCEC_Deployment_Manual: ค่าตั้งและตัวแปร Railway ทั้งสามบริการ deployment สำรอง กู้คืน และดูแล
- OCEC_Monthly_Cost: ราคา วิธีคิดเงิน และแบบจำลอง 10,000 คนต่อเดือน

ไฟล์เอกสารและภาพไม่เข้า Git เพราะมีภาพข้อมูลที่แสดงจริงบนระบบ ค่า secret ไม่ใส่ในเอกสารทั่วไป รับผ่าน Railway Variables หรือ password manager ที่ควบคุมสิทธิ์

Markdown ปัจจุบัน: admin-guide.md, data-intake-spec.md, db-schema.md, architecture.md, setup-railway.md, setup-cloudflare-r2.md, runbook.md, rate-limit-ip.md, name-normalization.md, capacity-and-cost.md และ go-live-checklist.md ส่วนแผนเก่ามีหมายเหตุเพื่อรักษาประวัติและไม่ให้เข้าใจเป็นคู่มือปัจจุบัน

Production อ่านอย่างเดียว ไม่มีการเพิ่มข้อมูล เปลี่ยน Variables เปลี่ยนแพ็กเกจ หรือ deploy เพื่อทำเอกสาร เว็บทดสอบที่ผู้ใช้อนุญาตคือ web-production-43608.up.railway.app
