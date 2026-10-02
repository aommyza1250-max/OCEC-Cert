import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ sessionId: "test-session" }) }));
vi.mock("@/lib/worker", () => ({ wakeWorker: async () => true }));

describe.skipIf(!url || url.endsWith("/ocec"))("ลบไฟล์ของหน้าที่ทิ้งไว้", async () => {
  const { prisma } = await import("@/lib/db");
  const { POST } = await import("./[id]/resolve/route");
  const ids = { program: randomUUID(), exam: randomUUID(), batch: randomUUID(), page: randomUUID(), other: randomUUID() };
  const pdfKey = `certificates/${ids.batch}/${ids.page}/page.pdf`;
  const previewKey = `previews/${ids.batch}/${ids.page}/page.webp`;

  async function call(action: string, version: number) {
    const response = await POST(
      new Request(`http://test/api/admin/pages/${ids.page}/resolve`, {
        method: "POST", body: JSON.stringify({ action, version }),
      }),
      { params: Promise.resolve({ id: ids.page }) },
    );
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    await prisma.examProgram.create({ data: { id: ids.program, code: `T${ids.program.slice(0, 6).toUpperCase()}`, name: "test" } });
    await prisma.exam.create({ data: { id: ids.exam, programId: ids.program, round: "HEAT", year: 2092 } });
    await prisma.batch.create({ data: { id: ids.batch, examId: ids.exam, profileKey: "HKIMO_HEAT" } });
    await prisma.stagingPage.create({
      data: { id: ids.page, batchId: ids.batch, pageNumber: 1, rawText: "", matchStatus: "UNMATCHED", pdfKey, previewKey },
    });
    await prisma.stagingPage.create({
      data: { id: ids.other, batchId: ids.batch, pageNumber: 2, rawText: "", matchStatus: "UNMATCHED" },
    });
  });

  afterAll(async () => {
    await prisma.batch.delete({ where: { id: ids.batch } }).catch(() => {});
    await prisma.exam.delete({ where: { id: ids.exam } }).catch(() => {});
    await prisma.examProgram.delete({ where: { id: ids.program } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("ห้ามลบก่อนทิ้ง และห้ามลบเมื่อหน้าอื่นยังใช้ไฟล์", async () => {
    expect((await call("PURGE_FILES", 0)).status).toBe(409);
    await prisma.stagingPage.update({ where: { id: ids.page }, data: { matchStatus: "DISCARDED" } });
    await prisma.stagingPage.update({ where: { id: ids.other }, data: { pdfKey } });
    expect((await call("PURGE_FILES", 0)).status).toBe(409);
    expect(await prisma.assetCleanup.count({ where: { batchId: ids.batch } })).toBe(0);
    await prisma.stagingPage.update({ where: { id: ids.other }, data: { pdfKey: null } });
  });

  it("ตัดการอ้างอิงและสร้างงานลบถาวรในทรานแซกชันเดียว", async () => {
    const result = await call("PURGE_FILES", 0);
    expect(result.status).toBe(200);
    expect(result.body.jobId).toBeTruthy();
    const page = await prisma.stagingPage.findUniqueOrThrow({ where: { id: ids.page } });
    expect(page).toMatchObject({ matchStatus: "DISCARDED", version: 1, pdfKey: null, previewKey: null });
    expect(page.review).toMatchObject({ filesPurgeRequestedAt: expect.any(String), filesCleanupId: expect.any(String) });
    expect(await prisma.assetCleanup.findFirst({ where: { batchId: ids.batch } })).toMatchObject({ oldPdfKey: pdfKey, oldPreviewKey: previewKey, completedAt: null });
    expect(await prisma.auditEvent.findFirst({ where: { batchId: ids.batch } })).toMatchObject({ action: "CERTIFICATE_FILES_PURGE_REQUESTED" });
    expect((await call("PURGE_FILES", 1)).status).toBe(409);
  });

  it("คืนหน้าหลังสั่งลบไม่ได้ แม้งานจับคู่เสร็จแล้ว", async () => {
    await prisma.job.updateMany({ where: { batchId: ids.batch }, data: { status: "DONE" } });
    expect((await call("RESTORE", 1)).status).toBe(409);
  });

  it("คิวลบที่ค้างสามารถสั่งลองใหม่ได้", async () => {
    const { POST: retry } = await import("../batches/[id]/retry-asset-cleanup/route");
    const response = await retry(new Request(`http://test/api/admin/batches/${ids.batch}/retry-asset-cleanup`, { method: "POST" }), {
      params: Promise.resolve({ id: ids.batch }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobId).toBeTruthy();
    expect(await prisma.job.findUnique({ where: { id: body.jobId } })).toMatchObject({ type: "MATCH", status: "QUEUED" });
  });
});
