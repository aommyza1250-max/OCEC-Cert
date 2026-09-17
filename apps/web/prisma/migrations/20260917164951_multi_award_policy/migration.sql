-- CreateEnum
CREATE TYPE "MultiAwardPolicy" AS ENUM ('UNDECIDED', 'ALL', 'MEDAL_ONLY');

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "multi_award_policy" "MultiAwardPolicy" NOT NULL DEFAULT 'UNDECIDED';
