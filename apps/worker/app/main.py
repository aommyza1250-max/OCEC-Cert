"""HTTP หน้าบ้านของ worker

เว็บไม่ได้ยิงงานมาที่นี่ตรง ๆ — เว็บเขียนแถวลงตาราง jobs แล้วเรียก /wake
เพื่อให้ worker ตื่นมาหยิบทันที ถ้า /wake พลาดไป งานก็ยังถูกหยิบในรอบ poll ถัดไปอยู่ดี
ออกแบบแบบนี้เพื่อไม่ให้คำขอของแอดมินพังเพราะ worker รีสตาร์ทอยู่พอดี
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException

from . import runner
from .config import settings
from .db import close_pool, connection

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    runner.start()
    yield
    runner.stop()
    close_pool()


app = FastAPI(title="OCEC Certificate Worker", lifespan=lifespan)


def _authorize(secret: str | None) -> None:
    if secret != settings().worker_shared_secret:
        raise HTTPException(status_code=401, detail="shared secret ไม่ถูกต้อง")


@app.get("/healthz")
def healthz():
    """Railway ใช้ตรวจว่า web server ทำงานอยู่ไหม"""
    return {"ok": True}


@app.post("/wake")
def wake(x_worker_secret: str | None = Header(default=None)):
    """ปลุกให้ไปหยิบงานในคิวทันที"""
    _authorize(x_worker_secret)
    runner.wake.set()
    return {"ok": True}


@app.get("/jobs/{job_id}")
def job_status(job_id: str, x_worker_secret: str | None = Header(default=None)):
    _authorize(x_worker_secret)
    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, type, status, progress, attempts, error, started_at, finished_at
            FROM jobs WHERE id = %s
            """,
            (job_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    return row
