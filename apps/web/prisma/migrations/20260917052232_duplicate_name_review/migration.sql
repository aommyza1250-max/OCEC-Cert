-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MatchStatus" ADD VALUE 'DUPLICATE_NAME';
ALTER TYPE "MatchStatus" ADD VALUE 'DISCARDED';

-- DropIndex
DROP INDEX "students_name_en_normalized_idx";

-- DropIndex
DROP INDEX "students_name_th_normalized_idx";
