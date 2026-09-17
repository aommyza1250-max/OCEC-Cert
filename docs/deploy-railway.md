# คู่มือ Deploy (Railway + Cloudflare R2)

## สิ่งที่ต้องมีก่อน

- [ ] repo อยู่บน GitHub แล้ว
- [ ] บัญชี Railway (Hobby Plan ~$5/เดือน)
- [ ] บัญชี Cloudflare (R2 ฟรี 10 GB แรก, ไม่มีค่า egress)

## 1. ตั้งค่า Cloudflare R2

1. **R2 → Create bucket** ชื่อ `ocec-cert`
2. **Manage R2 API Tokens → Create API Token** สิทธิ์ *Object Read & Write*
   เก็บ Access Key ID และ Secret Access Key ไว้
3. **Settings → Public access → Connect Domain** ผูกโดเมนย่อย เช่น `files.example.com`
   ค่านี้คือ `R2_PUBLIC_BASE_URL` ใช้เสิร์ฟรูป preview ผ่าน CDN
4. **Settings → CORS Policy** วางค่าจาก `infra/cloudflare-r2-cors.json`
   แก้ `AllowedOrigins` เป็นโดเมนจริงของเว็บ
   *ข้ามขั้นนี้ไม่ได้ ไม่งั้นแอดมินจะอัปโหลดไฟล์ไม่ได้เลย*
5. ตั้งให้ prefix `previews/` อ่านได้สาธารณะ ส่วน `certificates/` และ `sources/` **ห้ามเปิดสาธารณะ**
   (ไฟล์ PDF เข้าถึงผ่าน presigned URL ที่หมดอายุใน 15 นาทีเท่านั้น)

## 2. สร้างโปรเจกต์บน Railway

สร้างโปรเจกต์เดียว แล้วใส่ 3 service ไว้ด้วยกัน เพื่อให้คุยผ่าน private network ได้ (ไม่มีค่า egress)

### 2.1 PostgreSQL
**New → Database → PostgreSQL** — Railway จะสร้างตัวแปร `DATABASE_URL` ให้อัตโนมัติ

### 2.2 Web
**New → GitHub Repo** เลือก repo นี้ แล้วตั้งค่า:

- Settings → Config as code: `infra/railway.web.json`
- Variables:
  ```
  DATABASE_URL=${{Postgres.DATABASE_URL}}
  R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID=...
  R2_SECRET_ACCESS_KEY=...
  R2_BUCKET=ocec-cert
  R2_PUBLIC_BASE_URL=https://files.example.com
  R2_FORCE_PATH_STYLE=false
  ADMIN_PASSWORD=<รหัสยาว ๆ>
  SESSION_SECRET=<openssl rand -hex 32>
  WORKER_BASE_URL=http://worker.railway.internal:8000
  WORKER_SHARED_SECRET=<openssl rand -hex 32>
  NEXT_PUBLIC_SITE_URL=https://<โดเมนเว็บ>
  ```
- Settings → Networking → Generate Domain (หรือผูกโดเมนของตัวเอง)

### 2.3 Worker
**New → GitHub Repo** เลือก repo เดิม แล้ว:

- Settings → Config as code: `infra/railway.worker.json`
- Service name ต้องเป็น `worker` (ให้ `worker.railway.internal` ชี้ถูก)
- Variables: `DATABASE_URL`, `R2_*` (ชุดเดียวกับเว็บ), `WORKER_SHARED_SECRET` (ต้องตรงกับเว็บ)
- **ห้าม** Generate Domain — worker ควรเข้าถึงได้จาก private network เท่านั้น

## 3. ตรวจหลัง deploy

```bash
curl https://<โดเมนเว็บ>/                    # ต้องได้หน้าค้นหา
curl https://<โดเมนเว็บ>/admin               # ต้องเด้งไปหน้า login
```

- migration รันอัตโนมัติจาก `startCommand` (`prisma migrate deploy`)
- worker healthcheck ผ่าน = ต่อฐานข้อมูลได้
- ทดสอบนำเข้าไฟล์จริง 1 รอบเล็ก ๆ ก่อนประกาศให้ผู้ปกครองใช้

## ประมาณการค่าใช้จ่าย

| รายการ | ต่อเดือน |
|---|---|
| Railway Hobby (web + worker + postgres) | ~$5 |
| Cloudflare R2 (10 GB แรก, ไม่มีค่า egress) | $0 |
| ส่วนเกินตามการใช้จริง | $0–2 |
| **รวม** | **~$5–7 (~175–250 บาท)** |
