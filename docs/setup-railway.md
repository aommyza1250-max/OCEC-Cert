# ตั้งค่าและ Deploy บน Railway

คู่มือนี้พาตั้งค่าตั้งแต่ยังไม่มีบัญชี จนเว็บใช้งานได้จริง
ทุกขั้นตอนมี **"วิธีตรวจว่าทำถูกแล้ว"** กำกับไว้

> **ต้องทำ [ตั้งค่า Cloudflare R2](setup-cloudflare-r2.md) ให้เสร็จก่อน** เพราะต้องใช้ค่าจากที่นั่น

---

> ปรับปรุง 1 ตุลาคม 2569: production จริงตั้งผ่าน Railway Settings (Dockerfile, On Failure 10 retries) ไม่ผูก infra/railway.*.json ซึ่งยังระบุ 3 retries ไฟล์นี้เป็นค่าทางประวัติ ไม่ใช่ snapshot ระบบจริง
> [Railway เลิกใช้ Config as Code](https://docs.railway.com/config-as-code) สำหรับบริการใหม่แล้ว ไฟล์ที่ใช้อยู่เดิมมี cutoff 1 ธันวาคม 2569 ให้ใช้ Settings หรือเตรียม Infrastructure as Code ไม่ทำ apply โดยไม่ได้ review

## ภาพรวมสิ่งที่จะสร้าง

โปรเจกต์เดียว มี 3 service คุยกันผ่าน private network (ไม่มีค่า egress ระหว่างกัน)

```
โปรเจกต์ ocec-cert
 ├── Postgres    ฐานข้อมูล (Railway สร้างให้)
 ├── web         Next.js — หน้าค้นหา + หน้าแอดมิน (มีโดเมนสาธารณะ)
 └── worker      Python — ตัด PDF / จับคู่ Excel (ไม่มีโดเมนสาธารณะ)
```

---

## 0. เตรียมของ

- [ ] โค้ดอยู่บน GitHub แล้ว (ถ้ายัง: สร้าง repo แล้ว `git push`)
- [ ] มีค่าจาก Cloudflare R2 ครบ 6 ตัว
- [ ] สุ่มค่าลับ 2 ตัวเตรียมไว้:
  ```bash
  echo "SESSION_SECRET=$(openssl rand -hex 32)"
  echo "WORKER_SHARED_SECRET=$(openssl rand -hex 32)"
  ```
- [ ] คิดรหัสผ่านแอดมินที่ยาวพอ (อย่างน้อย 12 ตัวอักษร)

---

## 1. สร้างโปรเจกต์และฐานข้อมูล

1. สมัคร/เข้า https://railway.app → **New Project**
2. เลือก **Deploy PostgreSQL**
3. ตั้งชื่อโปรเจกต์ว่า `ocec-cert`

**ตรวจว่าทำถูก:** เห็นกล่อง **Postgres** ในโปรเจกต์ และแท็บ **Variables** มี `DATABASE_URL`

> ใน Railway ให้อ้างค่าข้ามservice ด้วย `${{Postgres.DATABASE_URL}}`
> อย่าคัดลอกค่ามาวางตรง ๆ เพราะถ้า Railway เปลี่ยนรหัสผ่านฐานข้อมูล ระบบจะพังทันที

---

## 2. สร้าง service `worker`

สร้าง worker **ก่อน** web เพราะ web ต้องรู้ที่อยู่ของ worker

1. ในโปรเจกต์เดิม → **New** → **GitHub Repo** → เลือก repo นี้
2. **Settings → General → Service Name** ตั้งเป็น **`worker`** ตรงตัวพิมพ์เล็ก
   > ⚠️ ชื่อนี้สำคัญ เพราะ web จะเรียกผ่าน `http://worker.railway.internal:8000`
   > ถ้าตั้งชื่ออื่นต้องแก้ `WORKER_BASE_URL` ให้ตรงกัน
3. **Settings → Source (หรือ General) → Root Directory** ปล่อยเป็น `/` (ค่าเริ่มต้น)
4. **Settings → Build** เลือก Dockerfile และกำหนด `/apps/worker/Dockerfile` โดยใช้ root ของ repo runtime เป็น stage สุดท้ายของ Dockerfile
5. **Variables** ใส่:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=<จาก R2>
   R2_SECRET_ACCESS_KEY=<จาก R2>
   R2_BUCKET=ocec-cert
   R2_FORCE_PATH_STYLE=false
   WORKER_SHARED_SECRET=<ค่าที่สุ่มไว้>
   PORT=8000
   ```
6. **Settings → Networking** — **อย่ากด Generate Domain**
   > worker ไม่ควรเข้าถึงได้จากอินเทอร์เน็ต ให้เข้าถึงได้จาก private network เท่านั้น

**ตรวจว่าทำถูก:** แท็บ **Deployments** ขึ้นสถานะ Active และ log มีบรรทัด
`job runner เริ่มทำงานแล้ว` กับ `Uvicorn running on http://0.0.0.0:8000`

---

## 3. สร้าง service `web`

1. **New** → **GitHub Repo** → เลือก repo เดิม
2. **Service Name** ตั้งเป็น `web`
3. **Settings → Source (หรือ General) → Root Directory** ปล่อยเป็น `/` (ค่าเริ่มต้น)
4. **Settings → Build** เลือก Dockerfile และกำหนด `/apps/web/Dockerfile` โดยใช้ root ของ repo
5. **Variables** ใส่:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=<จาก R2>
   R2_SECRET_ACCESS_KEY=<จาก R2>
   R2_BUCKET=ocec-cert
   R2_PUBLIC_BASE_URL=https://files.example.com
   R2_FORCE_PATH_STYLE=false
   ADMIN_PASSWORD=<รหัสผ่านแอดมิน>
   SESSION_SECRET=<ค่าที่สุ่มไว้>
   WORKER_BASE_URL=http://worker.railway.internal:8000
   WORKER_SHARED_SECRET=<ค่าเดียวกับที่ใส่ใน worker>
   NEXT_PUBLIC_SITE_URL=https://cert.example.com
   PORT=3000
   ```
5. **Settings → Networking → Generate Domain** (หรือ **Custom Domain** ถ้ามีโดเมนเอง)

> ⚠️ `WORKER_SHARED_SECRET` ต้องเป็นค่าเดียวกันทั้งสอง service
> ถ้าไม่ตรง ระบบจะยังทำงานได้แต่ช้าลง (worker จะไม่ถูกปลุก ต้องรอรอบ poll ทุก 2 วินาที)

**ตรวจว่าทำถูก:** เปิดโดเมนที่ได้ ต้องเห็นหน้าค้นหา และ log มีบรรทัด
`All migrations have been successfully applied` (migration รันอัตโนมัติตอน deploy ครั้งแรก)

---

## 4. กลับไปแก้ CORS ที่ Cloudflare

ตอนนี้รู้โดเมนจริงแล้ว ต้องกลับไปใส่ใน CORS ของ R2

1. Cloudflare → R2 → bucket `ocec-cert` → **Settings → CORS Policy**
2. แก้ `AllowedOrigins` ให้มีโดเมนจริง เช่น `["https://cert.example.com"]`

**ตรวจว่าทำถูก:** ลองอัปโหลด ZIP ทดสอบผ่านหน้าแอดมิน ต้องขึ้นจนครบ 100%

---

## 5. ตรวจหลัง deploy

```bash
# หน้าค้นหาต้องเปิดได้
curl -s -o /dev/null -w "%{http_code}\n" https://cert.example.com/
# ต้องได้ 200

# หน้าแอดมินต้องเด้งไป login
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://cert.example.com/admin
# ต้องได้ 307 และ redirect ไป /admin/login

# worker ต้องเข้าไม่ได้จากภายนอก (ถ้าทำตามข้อ 2 ถูก จะไม่มีโดเมนให้ลองเลย)
```

**ตรวจ worker ว่าต่อฐานข้อมูลได้:** ดูใน Railway แท็บ **Deployments** ของ service `worker`
`/healthz` ตอบ `{"ok":true}` ตรวจ HTTP process เท่านั้น **ไม่ได้คิวรีฐานข้อมูล** ต้องดู runner log และทดสอบงานสังเคราะห์ใน staging เพื่อยืนยันการเชื่อม DB/R2 เพิ่มเติม

ไฟล์ railway.*.json ปัจจุบันยังไม่ได้กำหนด healthcheckPath หากต้องการ healthcheck ให้ตั้งใน Railway หรือประกาศใน config อย่างชัดเจน

---

## 6. นำเข้าข้อมูลจริงรอบแรก

อย่าเพิ่งประกาศให้ผู้ปกครองใช้ ให้ทดลองนำเข้ารอบเล็กก่อน 1 รอบ
แล้วไล่ตาม [เช็คลิสต์ก่อนเปิดใช้จริง](go-live-checklist.md)

---

## ตัวแปรเพิ่มเติมและค่าใช้จ่าย

- Web: `RETENTION_MONTHS=24`, `SEARCH_RATE_LIMIT_PER_MIN=300`, `LOGIN_RATE_LIMIT_PER_MIN=10` เป็นค่าปริยาย
- Worker: `RETENTION_ENABLED=false`, `SOURCE_ZIP_KEEP_DAYS=0`, `CERT_IMAGE_DPI=150`, `CERT_IMAGE_QUALITY=85`, `POLL_INTERVAL_SEC=2.0`, `MAX_ATTEMPTS=3`
- `PORT` ของ worker ต้องตรงกับ `WORKER_BASE_URL`; Dockerfile ใช้ `${PORT:-8000}`
- `NEXT_PUBLIC_SITE_URL` อยู่ในไฟล์ตัวอย่างแต่ไม่มีการอ่านใน application ปัจจุบัน ไม่ใช้แทน CORS และไม่รับประกันการตั้ง runtime NEXT_PUBLIC จะเปลี่ยนค่าที่ build ไปแล้ว
- กฎ parser เก็บใน `app/certificate_profiles/` ไม่ใช้ NAME_ANCHOR หรือ CERT_NO_PATTERN เป็น env แล้ว
- Build web รัน Prisma generate; ตอน start รัน migrate deploy และ generate ก่อน server.js ห้ามใช้ migrate dev หรือ db push กับ production
- อย่าเปิด retention ลบจริงจนตรวจ dry-run ผ่าน และเก็บไฟล์สำรองนอกระบบแล้ว

ค่าใช้จ่ายไม่คงที่ $5–7 ต้องดูการใช้ RAM CPU volume และ egress จริง ดู [แบบจำลอง 10,000 คนต่อเดือน](capacity-and-cost.md) ซึ่งแยก minimum plan ออกจากค่าใช้งาน ไม่บวก Hobby $5 ซ้ำเมื่อใช้เกินเครดิต
