-- AlterTable
ALTER TABLE "students" ADD COLUMN     "school" TEXT,
ADD COLUMN     "school_normalized" TEXT;

-- CreateIndex
CREATE INDEX "students_name_school_idx" ON "students"("name_en_normalized", "school_normalized");
