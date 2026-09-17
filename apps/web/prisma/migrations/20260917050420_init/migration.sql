-- pg_trgm: ใช้ทำ trigram index สำหรับค้นหาชื่อบางส่วน (LIKE '%คำค้น%') ให้เร็วระดับมิลลิวินาที
-- ต้องสร้างก่อนตาราง เพราะ index ท้ายไฟล์อ้างถึง gin_trgm_ops
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "ExamKind" AS ENUM ('DOMESTIC', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'SPLITTING', 'SPLIT_DONE', 'MATCHING', 'READY', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'SKIPPED_FOREIGN', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SPLIT', 'MATCH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "exam_programs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ExamKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "name_th" TEXT,
    "name_en" TEXT,
    "name_th_normalized" TEXT,
    "name_en_normalized" TEXT,
    "name_en_sort_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "source_pdf_key" TEXT,
    "source_excel_key" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging_pages" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "raw_text" TEXT NOT NULL,
    "extracted_name" TEXT,
    "extracted_name_normalized" TEXT,
    "extracted_name_sort_key" TEXT,
    "cert_no" TEXT,
    "level" TEXT,
    "pdf_key" TEXT,
    "preview_key" TEXT,
    "match_status" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_student_id" UUID,
    "matched_manually" BOOLEAN NOT NULL DEFAULT false,
    "match_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staging_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "staging_page_id" UUID NOT NULL,
    "pdf_key" TEXT NOT NULL,
    "preview_key" TEXT,
    "page_number" INTEGER NOT NULL,
    "award" TEXT,
    "cert_no" TEXT,
    "level" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "batch_id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_programs_code_key" ON "exam_programs"("code");

-- CreateIndex
CREATE INDEX "exams_academic_year_idx" ON "exams"("academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "exams_program_id_academic_year_key" ON "exams"("program_id", "academic_year");

-- CreateIndex
CREATE INDEX "students_name_en_normalized_idx" ON "students"("name_en_normalized");

-- CreateIndex
CREATE INDEX "students_name_th_normalized_idx" ON "students"("name_th_normalized");

-- CreateIndex
CREATE INDEX "batches_exam_id_idx" ON "batches"("exam_id");

-- CreateIndex
CREATE INDEX "batches_status_idx" ON "batches"("status");

-- CreateIndex
CREATE INDEX "staging_pages_batch_id_match_status_idx" ON "staging_pages"("batch_id", "match_status");

-- CreateIndex
CREATE INDEX "staging_pages_extracted_name_normalized_idx" ON "staging_pages"("extracted_name_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "staging_pages_batch_id_page_number_key" ON "staging_pages"("batch_id", "page_number");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_staging_page_id_key" ON "certificates"("staging_page_id");

-- CreateIndex
CREATE INDEX "certificates_student_id_idx" ON "certificates"("student_id");

-- CreateIndex
CREATE INDEX "certificates_batch_id_idx" ON "certificates"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_exam_id_student_id_key" ON "certificates"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "jobs_status_created_at_idx" ON "jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "jobs_batch_id_idx" ON "jobs"("batch_id");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "exam_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_pages" ADD CONSTRAINT "staging_pages_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_pages" ADD CONSTRAINT "staging_pages_matched_student_id_fkey" FOREIGN KEY ("matched_student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_staging_page_id_fkey" FOREIGN KEY ("staging_page_id") REFERENCES "staging_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Trigram index สำหรับค้นหาชื่อ (Prisma ประกาศ gin_trgm_ops ใน schema.prisma ตรง ๆ ไม่ได้)
-- รองรับการค้นหาแบบ LIKE '%...%' ซึ่ง btree index ธรรมดาช่วยไม่ได้
-- ============================================================
CREATE INDEX "students_name_th_normalized_trgm_idx"
  ON "students" USING GIN ("name_th_normalized" gin_trgm_ops);

CREATE INDEX "students_name_en_normalized_trgm_idx"
  ON "students" USING GIN ("name_en_normalized" gin_trgm_ops);

-- ใช้จับคู่แบบสลับชื่อ-นามสกุล (nameSortKey) ตอน match Excel
CREATE INDEX "students_name_en_sort_key_idx"
  ON "students" ("name_en_sort_key");

-- ใช้จับคู่ด้วยเลขเกียรติบัตร ซึ่งแม่นกว่าชื่อเมื่อมีคนชื่อซ้ำ
CREATE INDEX "staging_pages_batch_id_cert_no_idx"
  ON "staging_pages" ("batch_id", "cert_no");
