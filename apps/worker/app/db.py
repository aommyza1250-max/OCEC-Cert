"""Connection pool ไปยัง Postgres

หมายเหตุสำคัญ: Prisma สร้าง UUID ฝั่ง client ไม่ได้ตั้ง DEFAULT ไว้ที่ฐานข้อมูล
เวลา worker INSERT จึงต้องสร้าง uuid4 เองทุกครั้ง (ดู new_id())
"""

import uuid
from contextlib import contextmanager

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            settings().database_url,
            min_size=1,
            max_size=4,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


@contextmanager
def connection():
    with pool().connection() as conn:
        yield conn


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def new_id() -> str:
    """UUID สำหรับ primary key — ต้องสร้างเองเพราะคอลัมน์ไม่มี DEFAULT"""
    return str(uuid.uuid4())


__all__ = ["Connection", "connection", "close_pool", "new_id", "pool"]
