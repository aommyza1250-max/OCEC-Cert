# Project Summary: Certificate Self-Service Portal & Automation

ระบบค้นหาและดาวน์โหลดเกียรติบัตรการสอบออนไลน์ พร้อมระบบประมวลผลและจัดการข้อมูลหลังบ้านแบบอัตโนมัติ ออกแบบมาเพื่อแก้ปัญหาความล่าช้าในการค้นหาไฟล์จาก Google Drive และรองรับทราฟฟิกช่วงประกาศผลสอบพร้อมกัน 500–600 คนได้อย่างเสถียร

---

## 1. ปัญหาและที่มาของโครงการ (Problem Statement)
* **ปัญหาเดิม:** เมื่อการสอบผ่านไปนาน ผู้ปกครองหรือผู้เข้าสอบต้องการขอไฟล์เกียรติบัตรย้อนหลัง เจ้าหน้าที่ (Admin) ต้องไปไล่ค้นหาไฟล์ทีละคนจาก Google Drive ทำให้เสียเวลา ยุ่งยาก และตกหล่น
* **เป้าหมาย:** สร้างเว็บพอร์ทัลแบบ Self-service ให้ผู้ปกครอง/นักเรียนพิมพ์ค้นหาชื่อแล้วดาวน์โหลดไฟล์ได้ทันที พร้อมระบบหลังบ้านให้แอดมินนำเข้าไฟล์รวมเล่มเพื่อตัดแยกหน้า เปลี่ยนชื่อไฟล์ และผูกเข้ากับฐานข้อมูลอัตโนมัติ

---

## 2. ฟังก์ชันและการทำงานของระบบ (How It Works)

### ฝั่งผู้ใช้งาน (User Portal)
1. **การค้นหา (Search):**
   * กรอกชื่อ-นามสกุล ได้ทั้งภาษาไทยและภาษาอังกฤษ (รองรับทั้งตัวพิมพ์เล็ก-ใหญ่ และเว้นวรรคที่ไม่เท่ากัน)
2. **การแสดงผลลัพธ์ (Display):**
   * หากบุคคลนั้นสอบหลายรายการ ระบบจะรวมและจัดกลุ่มเกียรติบัตรทั้งหมดของคนนั้น แยกตามรายการสอบและปีการศึกษา
   * แสดงรูปภาพตัวอย่าง (Preview Thumbnail) ของเกียรติบัตรบนหน้าเว็บ
3. **การดาวน์โหลด (Download):**
   * มีปุ่มกดดาวน์โหลดไฟล์ PDF คุณภาพสูง โดยโหลดตรงผ่าน CDN ไม่ดึง Bandwidth จากเซิร์ฟเวอร์หลัก

### ฝั่งผู้ดูแลระบบ (Admin Workflow)
รองรับการประมวลผลไฟล์เกียรติบัตร 2 รูปแบบ:

* **แบบที่ 1: เกียรติบัตรเฉพาะของไทย (Domestic)**
  1. แอดมินอัปโหลดไฟล์ PDF รวมเล่ม (หลายหน้าในไฟล์เดียว)
  2. ระบบดึงข้อความชื่อ-สกุลจากเนื้อหาในแต่ละหน้า แล้วตัดแยก (Split) ออกมาเป็นไฟล์รายบุคคล: `{FIRSTNAME}_{LASTNAME}_{EXAM_ID}.pdf` พร้อมสร้างรูป Preview
  3. แอดมินอัปโหลดไฟล์รายชื่อ Excel สรุปผลสอบ
  4. ระบบ Normalize ชื่อภาษาอังกฤษจาก Excel และนำมาจับคู่ (Match) กับชื่อไฟล์ PDF อัตโนมัติ ก่อนบันทึกข้อมูลลงฐานข้อมูล

* **แบบที่ 2: เกียรติบัตรรวมประเทศ (International)**
  1. แอดมินอัปโหลดไฟล์ PDF รวมเล่ม
  2. ระบบสแกนตรวจหาข้อความสัญชาติ เช่น `from THAILAND`
     * หากไม่ใช่คนไทย: ข้ามหน้านั้นไปทันที
     * หากเป็นคนไทย: ดึงชื่อ, ตัดแยกหน้าเฉพาะคนไทย, สร้างรูป Preview และเปลี่ยนชื่อไฟล์
  3. แอดมินอัปโหลด Excel รายชื่อเฉพาะของไทย เพื่อ Match ข้อมูลและบันทึกลงระบบ

---

## 3. เครื่องมือและเทคโนโลยีที่ใช้ (Tech Stack)

* **Frontend:** **Next.js (React) + Tailwind CSS**
  * หน้า UI ค้นหาข้อมูลแบบ Mobile-first รองรับการเปิดพรีวิวรูปภาพ
  * หน้า Dashboard ของ Admin สำหรับอัปโหลดไฟล์และแสดงตารางสรุปผลการ Match ข้อมูล
* **Backend & API:** **Node.js / Express หรือ Next.js Server Actions**
  * จัดการระบบค้นหาชื่อผู้สอบ และสร้าง Direct/Presigned URL ไปยัง Object Storage
* **PDF Processing Engine (Worker):** **Python + PyMuPDF (`fitz`)**
  * ทำหน้าที่สกัดข้อความ (Text Parsing), คัดกรองคำว่า `from THAILAND`, แยกไฟล์ PDF รายบุคคล, และแปลงหน้าเกียรติบัตรเป็นภาพ WebP
* **Database:** **PostgreSQL**
  * จัดการความสัมพันธ์ของ 3 ตารางหลัก: `exams`, `students`, `certificates`
  * ทำ Index บนฟิลด์ `name_en_normalized` และ `name_th` เพื่อให้ค้นหาได้ทันทีในระดับมิลลิวินาที
* **Storage:** **Cloudflare R2**
  * ใช้เก็บไฟล์รูปภาพ Preview และไฟล์ PDF เกียรติบัตรทั้งหมด รองรับ S3-Compatible API

---

## 4. โครงสร้างการ Deploy และงบประมาณ (Infrastructure & Deployment)

ระบบถูกออกแบบโดยแยกส่วนการประมวลผล (Compute) ออกจากส่วนจัดเก็บไฟล์ (Storage) เพื่อป้องกันเซิร์ฟเวอร์ค้างเมื่อมีคนเข้าพร้อมกัน 500–600 คน:

```
[ ผู้ใช้งาน 500-600 คน ]
         │
         ├── ค้นหาชื่อ / โหลดเว็บ UI ────> [ Railway ] (Web + Worker + PostgreSQL)
         │
         └── โหลดรูป / ดาวน์โหลด PDF ───> [ Cloudflare R2 ] (CDN Direct Download)
```

* **Application & Database Host:** **Railway (Hobby Plan - $5/mo)**
  * รัน Container ของเว็บ, ตัวประมวลผล Python และฐานข้อมูล PostgreSQL ไว้ในโปรเจกต์เดียวกัน เชื่อมต่อผ่าน Private Network
  * รองรับการสเกลตามการใช้งานจริง (Pay-as-you-go) ป้องกันระบบล่ม
* **File Delivery:** **Cloudflare R2 + Cloudflare CDN (Free Tier - 0 บาท)**
  * ฟรีพื้นที่จัดเก็บ 10 GB แรก (เก็บเกียรติบัตรได้หลายหมื่นใบ)
  * **Zero Egress Fee:** ฟรีค่าดาวน์โหลดไฟล์ทั้งหมด ไม่ว่าผู้ปกครองจะกดโหลดกี่ร้อยกี่พันครั้ง จะไม่มีค่าใช้จ่าย Bandwidth เพิ่มเติม
* **ประมาณการค่าใช้จ่ายรวม:** **~$5 – $7 ต่อเดือน (~175 – 250 บาท/เดือน)** คุมงบประมาณได้คงที่
---

## 5. โครงสร้างโปรเจกต์

```
OCEC-Cert/
├── apps/
│   ├── web/            Next.js 15 + Tailwind 4 + Prisma  (หน้าค้นหา + หน้าแอดมิน)
│   └── worker/         Python 3.12 + FastAPI + PyMuPDF   (ตัด PDF / preview / จับคู่ Excel)
├── shared/             ไฟล์ที่ทั้งสองภาษาใช้ร่วมกัน (เคสทดสอบ normalize ชื่อ)
├── docs/               สเปกและคู่มือ
├── infra/              ไฟล์ตั้งค่า Railway และ CORS ของ R2
├── scripts/            สคริปต์ dev และทดสอบโหลด
└── docker-compose.yml  สภาพแวดล้อม dev (postgres + minio + worker)
```

| เอกสาร | เนื้อหา |
|---|---|
| [docs/architecture.md](docs/architecture.md) | ภาพรวมระบบและลำดับการทำงานของการนำเข้า |
| [docs/db-schema.md](docs/db-schema.md) | ตาราง index และเหตุผลเบื้องหลัง |
| [docs/name-normalization.md](docs/name-normalization.md) | **กฎ normalize ชื่อ — แหล่งความจริงเดียว** |
| [docs/pdf-parsing-notes.md](docs/pdf-parsing-notes.md) | วิธีอ่านชื่อจากหน้าเกียรติบัตร และวิธีปรับจูนกับไฟล์จริง |
| [docs/data-intake-spec.md](docs/data-intake-spec.md) | **สเปกการรับและนำเข้าข้อมูล (โครงสร้าง ZIP, ชื่อไฟล์, และการ Match)** |
| [docs/deploy-railway.md](docs/deploy-railway.md) | ขั้นตอน deploy ทีละสเต็ป |
| [docs/runbook.md](docs/runbook.md) | คู่มือแก้ปัญหาเมื่อระบบมีปัญหา |

---

## 6. เริ่มพัฒนา (Getting Started)

ต้องมี: Node.js 20+, pnpm, Docker Desktop

```bash
cp .env.example .env            # แก้ ADMIN_PASSWORD และ SESSION_SECRET ก่อน
cp .env apps/web/.env
cp .env apps/worker/.env

./scripts/dev.sh                # ยก postgres + minio + worker และอัปเดตฐานข้อมูล

cd apps/web
pnpm db:seed                    # ใส่ข้อมูลตัวอย่าง (ชื่อสมมติทั้งหมด)
pnpm dev                        # http://localhost:3000
```

| ปลายทาง | ที่อยู่ |
|---|---|
| หน้าค้นหา | http://localhost:3000 |
| หน้าแอดมิน | http://localhost:3000/admin |
| worker healthcheck | http://localhost:8000/healthz |
| MinIO console | http://localhost:9001 (`minioadmin` / `minioadmin`) |

### การทดสอบ

```bash
cd apps/web && pnpm test                               # normalize ฝั่ง TypeScript
docker compose exec worker python -m pytest -q         # normalize / extract / Excel ฝั่ง Python
docker compose exec worker python scripts/e2e_demo.py  # ทั้งสายงาน ด้วยไฟล์สังเคราะห์
k6 run scripts/loadtest.js                             # จำลอง 600 คนค้นหาพร้อมกัน
```

---

## 7. สิ่งที่ต้องเตรียมก่อนใช้งานจริง

- [ ] **ไฟล์ตัวอย่างจริง** — PDF รวมเล่มทั้งสองแบบ + Excel ที่คู่กัน
      เพื่อปรับจูนการอ่านชื่อ (ดู [docs/pdf-parsing-notes.md](docs/pdf-parsing-notes.md))
- [ ] **Cloudflare R2** — bucket, API token, custom domain, CORS policy
- [ ] **Railway** — Hobby Plan และเชื่อม GitHub repo
- [ ] ตัดสินใจว่า `EXAM_ID` ในชื่อไฟล์คือรหัสรายการสอบหรือเลขที่นั่งสอบของผู้เข้าสอบ
- [ ] ประเมินจำนวนเกียรติบัตรย้อนหลังทั้งหมด (มีผลต่อโควต้า 10 GB ของ R2)

> **ข้อควรระวังด้านข้อมูลส่วนบุคคล:** พอร์ทัลนี้เปิดให้ใครก็ได้ค้นหาชื่อผู้อื่น
> ระบบจึงบังคับพิมพ์อย่างน้อย 3 ตัวอักษร จำกัดจำนวนผลลัพธ์ และจำกัดอัตราการค้นหาต่อ IP
> **ห้ามนำไฟล์เกียรติบัตรหรือรายชื่อจริงเข้า git เด็ดขาด**
