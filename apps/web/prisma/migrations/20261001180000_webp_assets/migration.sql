-- เก็บ PDF รายใบเฉพาะหน้าที่ยังจับคู่ไม่ได้หรือยังแปลงรูปไม่สำเร็จ
ALTER TABLE "certificates" ALTER COLUMN "pdf_key" DROP NOT NULL;

ALTER TYPE "JobType" ADD VALUE 'MIGRATE_WEBP';

-- บันทึกคีย์เก่าหลังสลับไปใช้ WebP แล้ว เพื่อให้ลบต่อได้หลัง worker รีสตาร์ท
CREATE TABLE "asset_cleanup" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "old_pdf_key" TEXT,
    "old_preview_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "asset_cleanup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_cleanup_batch_id_completed_at_idx" ON "asset_cleanup"("batch_id", "completed_at");
ALTER TABLE "asset_cleanup" ADD CONSTRAINT "asset_cleanup_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
