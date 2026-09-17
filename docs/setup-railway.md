# ตั้งค่าและ Deploy บน Railway

คู่มือนี้พาตั้งค่าตั้งแต่ยังไม่มีบัญชี จนเว็บใช้งานได้จริง
ทุกขั้นตอนมี **"วิธีตรวจว่าทำถูกแล้ว"** กำกับไว้

> **ต้องทำ [ตั้งค่า Cloudflare R2](setup-cloudflare-r2.md) ให้เสร็จก่อน** เพราะต้องใช้ค่าจากที่นั่น

---

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
3. **Settings → Source (หรือ General) → Root Directory** ใส่ **`/apps/worker`** *(สำคัญมาก เป็น Monorepo ต้องระบุโฟลเดอร์)*
4. **Settings → Build → Config as code** ใส่ `infra/railway.worker.json`
5. **Variables** ใส่:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=<จาก R2>
   R2_SECRET_ACCESS_KEY=<จาก R2>
   R2_BUCKET=ocec-cert
   R2_FORCE_PATH_STYLE=false
   WORKER_SHARED_SECRET=<ค่าที่สุ่มไว้>
   ```
6. **Settings → Networking** — **อย่ากด Generate Domain**
   > worker ไม่ควรเข้าถึงได้จากอินเทอร์เน็ต ให้เข้าถึงได้จาก private network เท่านั้น

**ตรวจว่าทำถูก:** แท็บ **Deployments** ขึ้นสถานะ Active และ log มีบรรทัด
`job runner เริ่มทำงานแล้ว` กับ `Uvicorn running on http://0.0.0.0:8000`

---

## 3. สร้าง service `web`

1. **New** → **GitHub Repo** → เลือก repo เดิม
2. **Service Name** ตั้งเป็น `web`
3. **Settings → Source (หรือ General) → Root Directory** ใส่ **`/apps/web`** *(สำคัญมาก)*
4. **Settings → Build → Config as code** ใส่ `infra/railway.web.json`
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
ถ้า healthcheck ขึ้นเขียว แปลว่า `/healthz` ตอบ 200 ซึ่งแปลว่าต่อฐานข้อมูลได้แล้ว

---

## 6. นำเข้าข้อมูลจริงรอบแรก

อย่าเพิ่งประกาศให้ผู้ปกครองใช้ ให้ทดลองนำเข้ารอบเล็กก่อน 1 รอบ
แล้วไล่ตาม [เช็คลิสต์ก่อนเปิดใช้จริง](go-live-checklist.md)

---

## ค่าใช้จ่ายที่คาดไว้

| รายการ | ต่อเดือน |
|---|---|
| Railway Hobby (web + worker + postgres) | ~$5 |
| Cloudflare R2 (10 GB แรก ไม่มีค่า egress) | $0 |
| ส่วนเกินตามการใช้จริง | $0–2 |
| **รวม** | **~$5–7 (~175–250 บาท)** |

### จุดที่จะทำให้บานปลาย

- **worker ทำงานค้าง** — งานตัด PDF กิน CPU เต็มตลอดเวลาที่ทำ ถ้า job ค้างวนซ้ำจะกินชั่วโมงเครื่อง
  ดูวิธีแก้ที่ [runbook.md](runbook.md)
- **เก็บ ZIP ต้นฉบับไว้ทุกรอบ** — ZIP จริงรอบละหลายร้อย MB ถ้าเก็บทุกรอบจะเต็ม 10 GB เร็ว
  พิจารณาลบ `sources/<batch id>/` หลังยืนยันว่านำเข้าถูกต้องแล้ว
- **ปล่อยให้ preview เรนเดอร์ละเอียดเกิน** — ค่าปริยาย `PREVIEW_DPI=110` ให้ไฟล์ราว 250 KB ต่อใบ
  ถ้าเพิ่มเป็น 200 ไฟล์จะใหญ่ขึ้นราว 3 เท่า
