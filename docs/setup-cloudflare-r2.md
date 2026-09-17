# ตั้งค่า Cloudflare R2 (ที่เก็บไฟล์)

คู่มือนี้พาตั้งค่าตั้งแต่ยังไม่มีบัญชี จนพร้อมใช้งานจริง
ทุกขั้นตอนมี **"วิธีตรวจว่าทำถูกแล้ว"** กำกับไว้ — ทำแล้วตรวจทีละขั้น อย่าข้าม

> **R2 ทำอะไรในระบบนี้**
> เก็บไฟล์ ZIP ต้นฉบับ, ไฟล์ PDF เกียรติบัตรรายคน และรูป preview
> ไฟล์ทั้งหมด **ไม่วิ่งผ่านเซิร์ฟเวอร์เว็บเลย** ทั้งขาขึ้นและขาลง
> นี่คือเหตุผลที่ระบบรับผู้ปกครอง 500–600 คนพร้อมกันได้ในงบไม่กี่ร้อยบาทต่อเดือน

---

## 1. สมัครและสร้าง Bucket

1. สมัครที่ https://dash.cloudflare.com (ใช้ฟรี ไม่ต้องผูกบัตรก็เริ่มได้)
2. เมนูซ้าย เลือก **R2 Object Storage** → กด **Create bucket**
3. ตั้งชื่อ `ocec-cert` → Location เลือก **Automatic** → กด **Create bucket**

**ตรวจว่าทำถูก:** กลับมาหน้า R2 แล้วเห็น bucket ชื่อ `ocec-cert` อยู่ในรายการ

> **จด Account ID ไว้** — อยู่มุมขวาของหน้า R2 (สตริงยาวประมาณ 32 ตัวอักษร)
> จะใช้ประกอบ URL: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

---

## 2. ออก API Token

1. หน้า R2 → กด **Manage R2 API Tokens** (มุมขวาบน) → **Create API Token**
2. ตั้งชื่อ เช่น `ocec-cert-app`
3. **Permissions** เลือก **Object Read & Write**
4. **Specify bucket** เลือกเฉพาะ `ocec-cert` (อย่าให้สิทธิ์ทุก bucket)
5. กด **Create API Token**

หน้าถัดมาจะแสดงค่า 3 ตัว **ซึ่งจะแสดงครั้งเดียวเท่านั้น** ให้คัดลอกเก็บทันที:

| ค่าที่เห็นบนหน้าจอ | เอาไปใส่ตัวแปร |
|---|---|
| Access Key ID | `R2_ACCESS_KEY_ID` |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` |
| Endpoint (`https://<account>.r2.cloudflarestorage.com`) | `R2_ENDPOINT` |

**ตรวจว่าทำถูก:** มีค่าครบ 3 ตัวเก็บไว้ในที่ปลอดภัย (เช่น password manager)
**ห้ามใส่ลงไฟล์ที่ commit ขึ้น git เด็ดขาด**

---

## 3. ผูกโดเมนสำหรับเสิร์ฟรูป preview

รูป preview ต้องโหลดตรงจาก CDN ไม่ผ่านเซิร์ฟเวอร์เว็บ จึงต้องมีโดเมนสาธารณะ

1. เข้า bucket `ocec-cert` → แท็บ **Settings**
2. หัวข้อ **Public access** → **Custom Domains** → **Connect Domain**
3. ใส่โดเมนย่อยที่ต้องการ เช่น `files.example.com`
   (โดเมนหลักต้องอยู่ใน Cloudflare อยู่แล้ว)
4. กด **Continue** → Cloudflare จะสร้าง DNS record ให้เอง → รอสถานะเป็น **Active**

ค่านี้คือ `R2_PUBLIC_BASE_URL` = `https://files.example.com`

**ตรวจว่าทำถูก:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://files.example.com/
# ได้ 404 ถือว่าใช้ได้ (แปลว่าโดเมนต่อถึง bucket แล้ว แค่ยังไม่มีไฟล์ชื่อนั้น)
# ถ้าได้ 000 หรือ error DNS แปลว่ายังไม่ Active ให้รอแล้วลองใหม่
```

---

## 4. ⚠️ ตั้งสิทธิ์รายโฟลเดอร์ (ขั้นที่พลาดไม่ได้)

ระบบแบ่งไฟล์ใน bucket เป็น 3 กลุ่ม และ **สิทธิ์ต้องต่างกัน**

| โฟลเดอร์ | เนื้อหา | สิทธิ์ที่ต้องเป็น |
|---|---|---|
| `previews/` | รูปตัวอย่างเกียรติบัตร | **เปิดสาธารณะ** — ต้องโหลดผ่าน CDN ได้ |
| `certificates/` | ไฟล์ PDF รายคน | **ห้ามเปิดสาธารณะ** |
| `sources/` | ZIP และ Excel ต้นฉบับ | **ห้ามเปิดสาธารณะ** |

ไฟล์ PDF เข้าถึงผ่าน **presigned URL ที่หมดอายุใน 15 นาที** ซึ่งระบบสร้างให้ตอนผู้ใช้กดดาวน์โหลด
ถ้าเผลอเปิด `certificates/` เป็นสาธารณะ ใครก็ตามที่เดา URL ถูกจะโหลดเกียรติบัตรของเด็กคนอื่นได้ทันที

**วิธีตั้ง:** Custom Domain ที่ผูกในข้อ 3 จะเปิดทั้ง bucket ให้อ่านได้
จึงต้องใส่ **WAF rule** บล็อกสองโฟลเดอร์ที่เหลือ:

1. เข้าโดเมนใน Cloudflare → **Security** → **WAF** → **Custom rules** → **Create rule**
2. ตั้งชื่อ `block-private-cert-paths`
3. เงื่อนไข (ใช้ Expression Editor วางตรง ๆ ได้):
   ```
   (http.host eq "files.example.com" and not starts_with(http.request.uri.path, "/previews/"))
   ```
4. Action เลือก **Block** → **Deploy**

**ตรวจว่าทำถูก:**
```bash
# รูป preview ต้องโหลดได้ (หลังนำเข้าข้อมูลแล้ว)
curl -s -o /dev/null -w "previews: %{http_code}\n" https://files.example.com/previews/<ไฟล์จริง>.webp
# ต้องได้ 200

# ไฟล์ PDF ต้องโดนบล็อก
curl -s -o /dev/null -w "certificates: %{http_code}\n" https://files.example.com/certificates/x.pdf
# ต้องได้ 403 — ถ้าได้ 404 แปลว่า rule ยังไม่ทำงาน ให้ตรวจ expression ใหม่
```

---

## 5. ⚠️ ตั้ง CORS (ข้ามไม่ได้ ไม่งั้นอัปโหลดไม่ได้เลย)

เบราว์เซอร์ของแอดมินส่งไฟล์ ZIP ขึ้น R2 โดยตรง ถ้าไม่ตั้ง CORS เบราว์เซอร์จะบล็อก
อาการที่เจอคือกดอัปโหลดแล้วขึ้น "เชื่อมต่อที่เก็บไฟล์ไม่ได้" ทั้งที่ค่าอื่นถูกหมด

1. เข้า bucket `ocec-cert` → **Settings** → **CORS Policy** → **Add CORS policy**
2. วาง JSON จาก `infra/cloudflare-r2-cors.json` แล้ว **แก้ `AllowedOrigins` เป็นโดเมนจริงของเว็บ**

```json
[
  {
    "AllowedOrigins": ["https://cert.example.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

**ตรวจว่าทำถูก:** หลัง deploy เว็บแล้ว ให้ลองอัปโหลด ZIP เล็ก ๆ ผ่านหน้าแอดมินจริง
ถ้าแถบความคืบหน้าเดินจนถึง 100% แปลว่า CORS ถูกต้อง

---

## 6. สรุปค่าที่ได้

| ตัวแปร | ค่า | ได้จากขั้นไหน |
|---|---|---|
| `R2_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | ข้อ 2 |
| `R2_ACCESS_KEY_ID` | Access Key ID | ข้อ 2 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key | ข้อ 2 |
| `R2_BUCKET` | `ocec-cert` | ข้อ 1 |
| `R2_PUBLIC_BASE_URL` | `https://files.example.com` | ข้อ 3 |
| `R2_FORCE_PATH_STYLE` | `false` | (R2 ไม่ต้องใช้ path-style ใช้ `true` เฉพาะตอน dev กับ MinIO) |

ขั้นต่อไป: [ตั้งค่า Railway](setup-railway.md)

---

## ค่าใช้จ่าย

- **10 GB แรกฟรี** — เกียรติบัตร 242 ใบของ HKIMO Final 2026 ใช้ประมาณ 400 MB
  ประมาณได้ว่าเก็บได้ราว 15–20 รอบการสอบในโควต้าฟรี
- **ไม่มีค่า egress** — ผู้ปกครองจะโหลดกี่พันครั้งก็ไม่มีค่าใช้จ่ายเพิ่ม
  (ต่างจาก S3 ที่คิดค่าโหลดต่อ GB ซึ่งเป็นเหตุผลหลักที่เลือก R2)
- เกิน 10 GB คิดประมาณ $0.015 ต่อ GB ต่อเดือน
