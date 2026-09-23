#!/usr/bin/env bash
# สร้างฐานข้อมูลแยกสำหรับเทสที่ต้องแตะฐานข้อมูลจริง (ocec_test) แล้วใส่ migration ล่าสุด
#
# เทสพวกนี้ล้างตารางทุกครั้งที่รัน จึงต้องไม่ใช้ฐาน dev (ocec) เด็ดขาด
# รันซ้ำได้ — ลบฐานเดิมทิ้งแล้วสร้างใหม่ทุกครั้ง
#
#   ./scripts/test-db.sh
#   docker compose exec -e TEST_DATABASE_URL=postgresql://ocec:ocec@postgres:5432/ocec_test worker python -m pytest -q
set -euo pipefail
cd "$(dirname "$0")/.."

docker exec ocec-postgres psql -U ocec -d postgres -qc "DROP DATABASE IF EXISTS ocec_test" -c "CREATE DATABASE ocec_test"
(cd apps/web && DATABASE_URL=postgresql://ocec:ocec@localhost:5432/ocec_test pnpm -s prisma migrate deploy)
echo "พร้อมแล้ว: postgresql://ocec:ocec@localhost:5432/ocec_test (ใน compose ใช้ host ชื่อ postgres)"
