# ---------- ฐานร่วม ----------
FROM python:3.12-slim AS base

# PyMuPDF และ Pillow มี wheel สำเร็จรูปบน linux/amd64 และ arm64 อยู่แล้ว
# จึงไม่ต้องลง build toolchain ให้ image บวม
WORKDIR /app

# ต้อง COPY app ก่อน pip install เพราะ setuptools ต้องเห็นตัวแพ็กเกจจริงตอน build wheel
COPY apps/worker/pyproject.toml ./pyproject.toml
COPY apps/worker/app ./app
RUN pip install --no-cache-dir . && rm -rf /root/.cache

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# ---------- สำหรับ dev (docker-compose ใช้ target นี้) ----------
FROM base AS dev
RUN pip install --no-cache-dir pytest ruff && rm -rf /root/.cache
# --reload ใช้ได้เพราะ compose mount ซอร์สเข้ามา
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---------- สำหรับ production (Railway build ถึงสเตจนี้) ----------
FROM base AS runtime
# 1 worker process พอ — งานหนักเป็น CPU-bound และรันทีละ job อยู่แล้ว
# เพิ่ม process ไม่ช่วยให้เร็วขึ้น แถมกินแรมบน Railway
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
