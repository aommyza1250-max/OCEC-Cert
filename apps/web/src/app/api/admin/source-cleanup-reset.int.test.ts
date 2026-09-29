/** อัปต้นฉบับใหม่หลังเคลียร์รอบก่อน — ทดสอบกับ ocec_test เท่านั้น */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ sessionId: "cleanup-reset-test" }) }));
vi.mock("@/lib/worker", () => ({ wakeWorker: async () => true }));

describe.skipIf(!url || url.endsWith("/ocec"))("อัปไฟล์ใหม่หลังเคลียร์ต้นฉบับ", async () => {
  const { prisma } = await import("@/lib/db");
  const { POST: attach } = await import("./batches/[id]/attach/route");
  const { POST: addCertificate } = await import("./participants/[entryId]/certificates/route");

  let ids: { program: string; exam: string; batch: string; entry: string; ownsProgram: boolean } | null;

  beforeEach(async () => {
    ids = null;
    const existing = await prisma.examProgram.findUnique({ where: { code: "HKIMO" } });
    const program = existing ?? await prisma.examProgram.create({
      data: { id: randomUUID(), code: "HKIMO", name: "Synthetic HKIMO" },
    });
    const exam = await prisma.exam.create({
      data: { programId: program.id, year: 2098, round: "FINAL" },
    });
    const batch = await prisma.batch.create({
      data: {
        examId: exam.id, status: "READY", profileKey: "HKIMO_FINAL",
        sourcesClearedAt: new Date(),
      },
    });
    const roster = await prisma.rosterImport.create({
      data: { batchId: batch.id, sourceKey: `sources/${batch.id}/roster.xlsx`, status: "ACTIVE" },
    });
    await prisma.batch.update({ where: { id: batch.id }, data: { activeRosterImportId: roster.id } });
    const entry = await prisma.rosterEntry.create({
      data: {
        batchId: batch.id, rosterImportId: roster.id, candidateNo: "9001",
        nameEn: "SOMCHAI JAIDEE", nameEnNormalized: "SOMCHAI JAIDEE",
        examMode: "ONLINE", source: "EXCEL",
      },
    });
    ids = {
      program: program.id, exam: exam.id, batch: batch.id, entry: entry.id,
      ownsProgram: existing === null,
    };
  });

  afterEach(async () => {
    if (!ids) return;
    await prisma.batch.delete({ where: { id: ids.batch } });
    await prisma.exam.delete({ where: { id: ids.exam } });
    if (ids.ownsProgram) await prisma.examProgram.delete({ where: { id: ids.program } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("อัป ZIP ใหม่แล้วเปิดรอบเคลียร์ครั้งใหม่", async () => {
    const key = `sources/${ids!.batch}/bundle-new.zip`;
    const response = await attach(
      new Request("http://test/attach", {
        method: "POST", body: JSON.stringify({ kind: "zip", key, fileName: "new.zip" }),
      }),
      { params: Promise.resolve({ id: ids!.batch }) },
    );
    expect(response.status).toBe(200);
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: ids!.batch } });
    expect(batch.sourceZipKey).toBe(key);
    expect(batch.sourcesClearedAt).toBeNull();
  });

  it("อัป PDF รายคนใหม่แล้วเปิดรอบเคลียร์ครั้งใหม่", async () => {
    const key = `sources/${ids!.batch}/pdf-new.pdf`;
    const response = await addCertificate(
      new Request("http://test/certificates", {
        method: "POST",
        body: JSON.stringify({ key, awardCode: "GOLD", purpose: "add", fileName: "new.pdf" }),
      }),
      { params: Promise.resolve({ entryId: ids!.entry }) },
    );
    expect(response.status).toBe(200);
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: ids!.batch } });
    expect(batch.sourcesClearedAt).toBeNull();
  });
});
