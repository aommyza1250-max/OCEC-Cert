# Project Summary: Certificate Self-Service Portal & Automation

ระบบค้นหาและดาวน์โหลดเกียรติบัตรการสอบออนไลน์ พร้อมระบบประมวลผลและจัดการข้อมูลหลังบ้านแบบอัตโนมัติ ออกแบบมาเพื่อแก้ปัญหาความล่าช้าในการค้นหาไฟล์จาก Google Drive และแยกการเสิร์ฟไฟล์ออกจากเว็บเพื่อรองรับช่วงประกาศผล ต้องทดสอบโหลดกับรุ่นที่ deploy ก่อนรับรองกำลังระบบ

---

## 1. ปัญหาและที่มาของโครงการ (Problem Statement)
* **ปัญหาเดิม:** เมื่อการสอบผ่านไปนาน ผู้ปกครองหรือผู้เข้าสอบต้องการขอไฟล์เกียรติบัตรย้อนหลัง เจ้าหน้าที่ (Admin) ต้องไปไล่ค้นหาไฟล์ทีละคนจาก Google Drive ทำให้เสียเวลา ยุ่งยาก และตกหล่น
* **เป้าหมาย:** สร้างเว็บพอร์ทัลแบบ Self-service ให้ผู้ปกครอง/นักเรียนพิมพ์ค้นหาชื่อแล้วดาวน์โหลดไฟล์ได้ทันที พร้อมระบบหลังบ้านให้แอดมินนำเข้าไฟล์รวมเล่มเพื่อตัดแยกหน้า เปลี่ยนชื่อไฟล์ และผูกเข้ากับฐานข้อมูลอัตโนมัติ

---

## 2. ฟังก์ชันและการทำงานของระบบ (How It Works)

### ฝั่งผู้ใช้งาน (User Portal)
1. **การค้นหา (Search):**
   * กรอกชื่อ-นามสกุล **ภาษาอังกฤษ** (รองรับทั้งตัวพิมพ์เล็ก-ใหญ่ และเว้นวรรคที่ไม่เท่ากัน)
     ค้นจากชื่ออังกฤษอย่างเดียว เพราะทั้งชีทรายชื่อและตัวเกียรติบัตรเป็นอังกฤษล้วน
     พิมพ์ไทยเข้ามาระบบจะบอกให้เปลี่ยนเป็นอังกฤษ ไม่ปล่อยให้ไปเจอ "ไม่พบ" ลอย ๆ
2. **การแสดงผลลัพธ์ (Display):**
   * หากบุคคลนั้นสอบหลายรายการ ระบบจะรวมและจัดกลุ่มเกียรติบัตรทั้งหมดของคนนั้น
     แยกตามรายการสอบ แล้วแยกย่อยเป็น "ปี + รอบ" (รายการที่มีผลล่าสุดอยู่บนสุด)
   * หัวการ์ดแสดงชื่ออังกฤษ, ระดับชั้นของใบล่าสุด และจำนวนใบแยกตามรายการสอบ เช่น `TIMO (3) · HKIMO (1)`
     (ใช้ระดับชั้นเมื่อไม่มีโรงเรียนในข้อมูล หากมี SCHOOL ในรายชื่อหรือข้อมูลโรงเรียนที่ใช้งานแล้วระบบแสดงโรงเรียน
     ถ้าวันหนึ่งมีข้อมูลโรงเรียน หน้าเว็บจะแสดงโรงเรียนแทนให้เอง)
   * แสดงรูปภาพตัวอย่าง (Preview Thumbnail) ของเกียรติบัตรบนหน้าเว็บ
3. **การดาวน์โหลด (Download):**
   * มีปุ่มกดดาวน์โหลดไฟล์ PDF คุณภาพสูง โดยโหลดตรงผ่าน CDN ไม่ดึง Bandwidth จากเซิร์ฟเวอร์หลัก

### ฝั่งผู้ดูแลระบบ

ลำดับปัจจุบันคือ **สร้างรอบ → อัป Excel → ตรวจร่าง → ใช้รายชื่อ → อัป ZIP → ตรวจรายการค้าง → เผยแพร่**

- หนึ่งรายการสอบ หนึ่งรอบ และหนึ่งปี ค.ศ. ใช้หนึ่งรอบนำเข้า รองรับทั้ง Online และ Onsite และอัปเพิ่มหลายครั้ง
- Excel ต้องมี `CANDIDATE NO` (ตัวเลขล้วน ไม่ซ้ำทั้งไฟล์), `CANDIDATE NAME`, `EXAM MODE` (`ONLINE`/`ONSITE`); `GRADE`, `SCHOOL`, `AWARD` เป็นข้อมูลเสริม
- ZIP รองรับ `<รางวัล>/*.pdf` หรือ `online/<รางวัล>/*.pdf` / `onsite/<รางวัล>/*.pdf` ห้ามปนสองแบบในไฟล์เดียว
- **รางวัลจากชื่อโฟลเดอร์เท่านั้น** แคตตาล็อกรายการและรอบกำหนดรางวัลที่รับ เช่น BBB 1st Prize และ Participation เฉพาะ Heat
- จับคู่เลขพร้อมตรวจชื่อ ถ้าโหมด ชื่อ สัญชาติ รอบหรือปีไม่ชัด ให้แอดมินตัดสิน ห้ามเดาสร้างคนใหม่
- Heat รับทุกหน้า โดย from อาจเป็นโรงเรียน Final กรองไทยและค้างหน้าที่ไม่มีหลักฐานประเทศ
- เผยแพร่คนที่พร้อม ค้างคนมีปัญหาไว้ ขณะเผยแพร่ต้องยกเลิกก่อนแก้
- มีประวัติการแก้ ปิดปรับปรุง ต่ออายุไฟล์ ล้าง ZIP และลบรอบผ่านหลังบ้าน

รองรับ HKIMO TIMO BBB HKICO HKISO ทั้ง Heat และ Final รายละเอียดที่ [คู่มือแอดมิน](docs/admin-guide.md) และ [สเปกนำเข้า](docs/data-intake-spec.md)

---

## 3. เครื่องมือและเทคโนโลยีที่ใช้ (Tech Stack)

* **Frontend:** **Next.js (React) + Tailwind CSS**
  * หน้า UI ค้นหาข้อมูลแบบ Mobile-first รองรับการเปิดพรีวิวรูปภาพ และบันทึกรูปภาพแยกจาก PDF
  * หน้า Dashboard ของ Admin สำหรับอัปโหลดไฟล์และแสดงตารางสรุปผลการ Match ข้อมูล
* **Backend & API:** **Next.js Route Handlers และ Server Components**
  * จัดการระบบค้นหาชื่อผู้สอบ และสร้าง Direct/Presigned URL ไปยัง Object Storage
* **PDF Processing Engine (Worker):** **Python + PyMuPDF (`fitz`)**
  * ทำหน้าที่สกัดข้อความ (Text Parsing), คัดกรองคำว่า `from THAILAND`, แยกไฟล์ PDF รายบุคคล, และแปลงหน้าเกียรติบัตรเป็นภาพ WebP
* **Database:** **PostgreSQL**
  * จัดการรายการสอบ ตัวคน รายชื่อร่าง รายชื่อที่ใช้ หน้าที่ตัด เกียรติบัตร คิว และ audit ตาม schema.prisma
  * ประกาศ GIN trigram index ใน schema.prisma บน `name_en_normalized` และ `name_th_normalized` เพื่อให้ค้นหาได้ทันทีในระดับมิลลิวินาที
* **Storage:** **Cloudflare R2**
  * ใช้เก็บไฟล์รูปภาพ Preview และไฟล์ PDF เกียรติบัตรทั้งหมด รองรับ S3-Compatible API

---

## 4. โครงสร้างการ Deploy และงบประมาณ (Infrastructure & Deployment)

ระบบถูกออกแบบโดยแยกส่วนการประมวลผล (Compute) ออกจากส่วนจัดเก็บไฟล์ (Storage) เพื่อลดภาระ web server ขณะส่งไฟล์ จำนวนคนพร้อมกันที่รองรับต้องทดสอบตามทรัพยากรและรูปแบบโหลดจริง:

```
[ ผู้ใช้งานเว็บ ]
         │
         ├── ค้นหาชื่อ / โหลดเว็บ UI ────> [ Railway ] (Web + Worker + PostgreSQL)
         │
         └── โหลดรูป / ดาวน์โหลด PDF ───> [ Cloudflare R2 ] (CDN Direct Download)
```

* **Application & Database Host:** **Railway (Hobby Plan - $5/mo)**
  * รัน Container ของเว็บ, ตัวประมวลผล Python และฐานข้อมูล PostgreSQL ไว้ในโปรเจกต์เดียวกัน เชื่อมต่อผ่าน Private Network
  * จ่ายตามทรัพยากรที่ใช้และกำหนด resource limit ต้องติดตามโหลดและปรับขนาดเมื่อจำเป็น
* **File Delivery:** **Cloudflare R2 และ preview Worker**
  * Standard storage มีโควต้าฟรี 10 GB-month และโควต้าคำขอรายเดือน ส่วนเกินคิดตามอัตราผู้ให้บริการ
  * **Zero Egress Fee:** ฟรีค่าดาวน์โหลดไฟล์ทั้งหมด ไม่ว่าผู้ปกครองจะกดโหลดกี่ร้อยกี่พันครั้ง จะไม่มีค่าใช้จ่าย Bandwidth เพิ่มเติม
* **ค่าใช้จ่าย:** คิดตาม RAM CPU volume และ egress จริง ไม่มีราคาตายตัวตามจำนวนคน ดู [แบบจำลองค่าใช้จ่าย 10,000 คนต่อเดือน](docs/capacity-and-cost.md)
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
| [docs/admin-guide.md](docs/admin-guide.md) | **คู่มือแอดมิน** — นำเข้าและเพิ่มข้อมูลทีหลัง เริ่มอ่านที่นี่ถ้าเป็นคนใช้งาน |
| [docs/data-intake-spec.md](docs/data-intake-spec.md) | สเปกการรับข้อมูล — โครงสร้าง ZIP, Excel, กฎการจับคู่ |
| [docs/setup-cloudflare-r2.md](docs/setup-cloudflare-r2.md) | ตั้งค่าที่เก็บไฟล์ทีละขั้น |
| [docs/setup-railway.md](docs/setup-railway.md) | ตั้งค่าและ deploy ทีละขั้น |
| [docs/go-live-checklist.md](docs/go-live-checklist.md) | เช็คลิสต์ก่อนเปิดใช้จริง |
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
docker compose exec worker python scripts/e2e_demo.py       # ทั้งสายงาน ด้วยไฟล์สังเคราะห์
docker compose exec worker python scripts/check_real_files.py  # ตรวจตัวอ่านกับไฟล์จริงใน tmp/
k6 run scripts/loadtest.js                             # จำลอง 600 คนค้นหาพร้อมกัน
```

---

## 7. สิ่งที่ต้องเตรียมก่อนใช้งานจริง

- [ ] **ไฟล์ ZIP ที่แยกโฟลเดอร์ตามรางวัล** ของแต่ละรายการสอบและรอบ
- [ ] **ไฟล์ Excel รายชื่อ** ที่มีคอลัมน์ `CANDIDATE NO` (สำคัญที่สุด — ใช้เป็นคีย์จับคู่)
- [ ] ถ้าเป็นรายการสอบใหม่ที่ยังไม่เคยนำเข้า ให้ตรวจโครงหน้าก่อนด้วย
      `docker compose exec worker python scripts/check_real_files.py`
      (ดู [docs/pdf-parsing-notes.md](docs/pdf-parsing-notes.md))
- [ ] **Cloudflare R2** — bucket, API token, custom domain, CORS policy
- [ ] **Railway** — Hobby Plan และเชื่อม GitHub repo
- [ ] ประเมินจำนวนเกียรติบัตรย้อนหลังทั้งหมด (มีผลต่อโควต้า 10 GB ของ R2)

> **ข้อควรระวังด้านข้อมูลส่วนบุคคล:** พอร์ทัลนี้เปิดให้ใครก็ได้ค้นหาชื่อผู้อื่น
> ระบบจึงบังคับพิมพ์อย่างน้อย 3 ตัวอักษร จำกัดจำนวนผลลัพธ์ และจำกัดอัตราการค้นหาต่อ IP
> **ห้ามนำไฟล์เกียรติบัตรหรือรายชื่อจริงเข้า git เด็ดขาด**
