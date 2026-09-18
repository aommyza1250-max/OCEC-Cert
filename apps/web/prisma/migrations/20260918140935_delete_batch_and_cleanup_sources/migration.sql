-- AlterEnum
ALTER TYPE "BatchStatus" ADD VALUE 'DELETING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'DELETE_BATCH';
ALTER TYPE "JobType" ADD VALUE 'CLEANUP_SOURCES';

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "sources_cleared_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "deleted_batches" (
    "id" UUID NOT NULL,
    "program_code" TEXT NOT NULL,
    "round" "ExamRound" NOT NULL,
    "year" INTEGER NOT NULL,
    "certificate_count" INTEGER NOT NULL,
    "student_count" INTEGER NOT NULL,
    "file_count" INTEGER NOT NULL,
    "bytes_freed" BIGINT NOT NULL,
    "note" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deleted_batches_deleted_at_idx" ON "deleted_batches"("deleted_at");
