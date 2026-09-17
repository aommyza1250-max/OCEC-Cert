/*
  Warnings:

  - You are about to drop the column `source_pdf_key` on the `batches` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "batches" DROP COLUMN "source_pdf_key",
ADD COLUMN     "source_zip_key" TEXT;
