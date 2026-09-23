-- ขั้นตอนนำเข้าแบบใหม่: รายชื่อมาก่อน + แยก online/onsite + บันทึกการแก้ไขของแอดมิน
--
-- migration นี้เพิ่มอย่างเดียว (ตาราง/คอลัมน์/ค่า enum ใหม่) ไม่ลบและไม่แก้ข้อมูลเดิมเลย
-- ข้อมูลชุดเดิมยังเผยแพร่อยู่เหมือนเดิม การสำรอง ล้าง และนำเข้าใหม่ เป็นงานแยกที่ต้องสั่งเอง
-- ดู docs/runbook.md หัวข้อ "นำข้อมูลชุดเดิมเข้าใหม่ตามขั้นตอนใหม่"

-- CreateEnum
CREATE TYPE "ExamMode" AS ENUM ('ONLINE', 'ONSITE');

-- CreateEnum
CREATE TYPE "RosterSource" AS ENUM ('EXCEL', 'MANUAL');

-- CreateEnum
CREATE TYPE "RosterImportStatus" AS ENUM ('PENDING', 'INVALID', 'READY', 'ACTIVATING', 'ACTIVE', 'SUPERSEDED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "PageSource" AS ENUM ('ZIP', 'SINGLE_PDF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'ROSTER_VALIDATE';
ALTER TYPE "JobType" ADD VALUE 'ROSTER_ACTIVATE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MatchStatus" ADD VALUE 'NAME_MISMATCH';
ALTER TYPE "MatchStatus" ADD VALUE 'MODE_MISMATCH';
ALTER TYPE "MatchStatus" ADD VALUE 'NATIONALITY_UNVERIFIED';
ALTER TYPE "MatchStatus" ADD VALUE 'PARSE_REVIEW';
ALTER TYPE "MatchStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "active_roster_import_id" UUID,
ADD COLUMN     "profile_key" TEXT;

-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "award_label" TEXT,
ADD COLUMN     "award_label_th" TEXT,
ADD COLUMN     "roster_entry_id" UUID;

-- AlterTable
ALTER TABLE "staging_pages" ADD COLUMN     "award_label" TEXT,
ADD COLUMN     "award_override" TEXT,
ADD COLUMN     "award_override_at" TIMESTAMP(3),
ADD COLUMN     "country_on_page" TEXT,
ADD COLUMN     "exam_mode" "ExamMode",
ADD COLUMN     "extra" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "manual_match" JSONB,
ADD COLUMN     "mode_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "mode_confirmed_for" "ExamMode",
ADD COLUMN     "nationality_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "parse_accepted_at" TIMESTAMP(3),
ADD COLUMN     "parse_errors" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "review" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "roster_entry_id" UUID,
ADD COLUMN     "school_on_page" TEXT,
ADD COLUMN     "source_job_id" UUID,
ADD COLUMN     "source_kind" "PageSource",
ADD COLUMN     "superseded_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warnings" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "roster_imports" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "status" "RosterImportStatus" NOT NULL DEFAULT 'PENDING',
    "source_key" TEXT NOT NULL,
    "file_name" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "online_count" INTEGER NOT NULL DEFAULT 0,
    "onsite_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "resolutions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "roster_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_import_rows" (
    "id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "candidate_no" TEXT NOT NULL,
    "name_en" TEXT,
    "name_th" TEXT,
    "exam_mode" "ExamMode" NOT NULL,
    "school" TEXT,
    "level" TEXT,
    "raw_award" TEXT,

    CONSTRAINT "roster_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_entries" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "candidate_no" TEXT NOT NULL,
    "name_en" TEXT,
    "name_th" TEXT,
    "name_en_normalized" TEXT,
    "name_th_normalized" TEXT,
    "name_en_sort_key" TEXT,
    "exam_mode" "ExamMode" NOT NULL,
    "source" "RosterSource" NOT NULL,
    "school" TEXT,
    "school_normalized" TEXT,
    "level" TEXT,
    "raw_award" TEXT,
    "source_row" INTEGER,
    "roster_import_id" UUID,
    "student_id" UUID,
    "student_linked_manually" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "batch_id" UUID,
    "batch_label" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "session_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_imports_batch_id_uploaded_at_idx" ON "roster_imports"("batch_id", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "roster_import_rows_import_id_candidate_no_key" ON "roster_import_rows"("import_id", "candidate_no");

-- CreateIndex
CREATE INDEX "roster_entries_batch_id_exam_mode_idx" ON "roster_entries"("batch_id", "exam_mode");

-- CreateIndex
CREATE INDEX "roster_entries_batch_id_name_en_normalized_idx" ON "roster_entries"("batch_id", "name_en_normalized");

-- CreateIndex
CREATE INDEX "roster_entries_batch_id_name_th_normalized_idx" ON "roster_entries"("batch_id", "name_th_normalized");

-- CreateIndex
CREATE INDEX "roster_entries_student_id_idx" ON "roster_entries"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_batch_id_candidate_no_key" ON "roster_entries"("batch_id", "candidate_no");

-- CreateIndex
CREATE INDEX "audit_events_batch_id_created_at_idx" ON "audit_events"("batch_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "batches_active_roster_import_id_key" ON "batches"("active_roster_import_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_roster_entry_id_award_key" ON "certificates"("roster_entry_id", "award");

-- CreateIndex
CREATE INDEX "staging_pages_batch_id_fingerprint_idx" ON "staging_pages"("batch_id", "fingerprint");

-- CreateIndex
CREATE INDEX "staging_pages_roster_entry_id_idx" ON "staging_pages"("roster_entry_id");

-- CreateIndex
CREATE INDEX "staging_pages_source_job_id_idx" ON "staging_pages"("source_job_id");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_active_roster_import_id_fkey" FOREIGN KEY ("active_roster_import_id") REFERENCES "roster_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_imports" ADD CONSTRAINT "roster_imports_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_import_rows" ADD CONSTRAINT "roster_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "roster_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_roster_import_id_fkey" FOREIGN KEY ("roster_import_id") REFERENCES "roster_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_pages" ADD CONSTRAINT "staging_pages_roster_entry_id_fkey" FOREIGN KEY ("roster_entry_id") REFERENCES "roster_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_pages" ADD CONSTRAINT "staging_pages_source_job_id_fkey" FOREIGN KEY ("source_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_roster_entry_id_fkey" FOREIGN KEY ("roster_entry_id") REFERENCES "roster_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

