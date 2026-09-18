-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'EXPIRE';

-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "files_deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "jobs" ALTER COLUMN "batch_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "certificates_expires_at_files_deleted_at_idx" ON "certificates"("expires_at", "files_deleted_at");
