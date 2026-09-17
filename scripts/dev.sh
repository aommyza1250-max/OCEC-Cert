#!/usr/bin/env bash
# ยกสภาพแวดล้อม dev ทั้งชุดขึ้นมา
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ยังไม่มีไฟล์ .env — คัดลอกจากตัวอย่างให้แล้ว กรุณาแก้ค่าที่จำเป็นก่อนรันใหม่"
  cp .env.example .env
  cp .env apps/web/.env
  cp .env apps/worker/.env
  exit 1
fi

echo "==> เริ่ม postgres / minio / worker"
docker compose up -d

echo "==> รอ postgres พร้อม"
until docker exec ocec-postgres pg_isready -U ocec >/dev/null 2>&1; do sleep 1; done

echo "==> อัปเดตฐานข้อมูล"
(cd apps/web && pnpm install --frozen-lockfile && pnpm prisma migrate deploy && pnpm prisma generate)

echo "==> พร้อมแล้ว"
echo "   เว็บ     : cd apps/web && pnpm dev   -> http://localhost:3000"
echo "   worker   : http://localhost:8000/healthz"
echo "   MinIO UI : http://localhost:9001 (minioadmin / minioadmin)"
echo "   ข้อมูลตัวอย่าง: cd apps/web && pnpm db:seed"
