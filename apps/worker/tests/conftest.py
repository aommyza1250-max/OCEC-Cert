"""ตัวช่วยของเทสที่แตะฐานข้อมูลจริง

เทสที่ใช้ fixture `db` จะรันเฉพาะเมื่อตั้ง TEST_DATABASE_URL ไว้ (ฐานแยก ocec_test)
ไม่งั้นข้ามไปเฉย ๆ — ห้ามชี้ไปฐาน dev เพราะทุกเทสล้างตารางทิ้งก่อนเริ่ม

    ./scripts/test-db.sh
    docker compose exec -e TEST_DATABASE_URL=postgresql://ocec:ocec@postgres:5432/ocec_test \\
        worker python -m pytest -q

ที่เก็บไฟล์ (R2) ใช้ของปลอมในหน่วยความจำแทน — ไม่แตะ MinIO ของ dev
"""

import io
import os

import pytest
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

import app.db
import app.storage

TABLES = (
    "audit_events", "certificates", "staging_pages", "roster_entries", "roster_import_rows",
    "roster_imports", "jobs", "batches", "students", "exams", "exam_programs", "deleted_batches",
)


class FakeS3:
    """S3 ปลอมเท่าที่ app/storage.py เรียกใช้"""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, Bucket, Key, Body, ContentType):  # noqa: N803 — ชื่อตาม boto3
        self.objects[Key] = bytes(Body)

    def download_fileobj(self, bucket, key, buffer):
        buffer.write(self.objects[key])

    def download_file(self, bucket, key, path):
        with open(path, "wb") as fp:
            fp.write(self.objects[key])

    def list_objects_v2(self, Bucket, Prefix, MaxKeys, ContinuationToken=None):  # noqa: N803
        items = [{"Key": k, "Size": len(v)} for k, v in sorted(self.objects.items()) if k.startswith(Prefix)]
        return {"Contents": items, "IsTruncated": False}

    def delete_objects(self, Bucket, Delete):  # noqa: N803
        for item in Delete["Objects"]:
            self.objects.pop(item["Key"], None)
        return {}


@pytest.fixture(scope="session")
def _test_pool():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("ไม่ได้ตั้ง TEST_DATABASE_URL — ข้ามเทสที่ต้องใช้ฐานข้อมูลจริง")
    if url.rstrip("/").endswith("/ocec"):
        pytest.exit("TEST_DATABASE_URL ชี้ไปฐาน dev — เทสจะล้างข้อมูลทิ้ง จึงหยุดไว้ก่อน", 1)
    pool = ConnectionPool(url, min_size=1, max_size=4, kwargs={"row_factory": dict_row}, open=True)
    yield pool
    pool.close()


@pytest.fixture
def db(_test_pool, monkeypatch):
    """ฐานข้อมูลว่างเปล่า + ที่เก็บไฟล์ปลอม สำหรับเทสหนึ่งตัว"""
    monkeypatch.setattr(app.db, "_pool", _test_pool)
    with _test_pool.connection() as conn:
        conn.execute(f"TRUNCATE {', '.join(TABLES)} CASCADE")
    storage = FakeS3()
    monkeypatch.setattr(app.storage, "_client", lambda: storage)
    yield storage


@pytest.fixture
def fake_storage(monkeypatch):
    storage = FakeS3()
    monkeypatch.setattr(app.storage, "_client", lambda: storage)
    return storage


def read_bytes(storage: FakeS3, key: str) -> io.BytesIO:
    return io.BytesIO(storage.objects[key])
