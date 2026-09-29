/**
 * รอบที่เผยแพร่อยู่ต้องปฏิเสธทุกการอัปโหลดและการแก้ไข — ทดสอบกับฐานข้อมูลจริง (ocec_test)
 *
 * รันเฉพาะเมื่อตั้ง TEST_DATABASE_URL (ดู scripts/test-db.sh):
 *   TEST_DATABASE_URL=postgresql://ocec:ocec@localhost:5432/ocec_test pnpm test
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ sessionId: "test-session" }) }));
vi.mock("@/lib/worker", () => ({ wakeWorker: async () => true }));

describe.skipIf(!url || url.endsWith("/ocec"))("ประตูของ API กับฐานข้อมูลจริง", async () => {
  const { prisma } = await import("@/lib/db");
  const ids = {
    program: randomUUID(),
    exam: randomUUID(),
    batch: randomUUID(),
    roster: randomUUID(),
    entry: randomUUID(),
    manual: randomUUID(),
    page: randomUUID(),
    job: randomUUID(),
  };
  const call = async (path: string, handler: Function, params: object, body: object) => {
    const request = new Request(`http://test${path}`, { method: "POST", body: JSON.stringify(body) });
    const response: Response = await handler(request, { params: Promise.resolve(params) });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    const code = `T${ids.program.slice(0, 6).toUpperCase()}`;
    await prisma.examProgram.create({ data: { id: ids.program, code, name: "test" } });
    await prisma.exam.create({ data: { id: ids.exam, programId: ids.program, round: "FINAL", year: 2091 } });
    await prisma.batch.create({
      data: { id: ids.batch, examId: ids.exam, status: "PUBLISHED", profileKey: "HKIMO_FINAL" },
    });
    await prisma.rosterImport.create({
      data: { id: ids.roster, batchId: ids.batch, status: "READY", sourceKey: `sources/${ids.batch}/r.xlsx` },
    });
    const entry = (id: string, candidateNo: string, source: "EXCEL" | "MANUAL") => ({
      id,
      batchId: ids.batch,
      candidateNo,
      nameEn: "SOMCHAI JAIDEE",
      nameEnNormalized: "SOMCHAI JAIDEE",
      examMode: "ONLINE" as const,
      source,
    });
    await prisma.rosterEntry.create({ data: entry(ids.entry, "1", "EXCEL") });
    await prisma.rosterEntry.create({ data: entry(ids.manual, "2", "MANUAL") });
    await prisma.job.create({
      data: { id: ids.job, batchId: ids.batch, type: "SPLIT", status: "DONE", payload: { fileName: "x.zip" } },
    });
    await prisma.stagingPage.create({
      data: {
        id: ids.page,
        batchId: ids.batch,
        pageNumber: 1,
        rawText: "",
        certNo: "1",
        extractedName: "SOMCHAI JAIDEE",
        extractedNameNormalized: "SOMCHAI JAIDEE",
        award: "GOLD",
        examMode: "ONSITE",
        matchStatus: "MODE_MISMATCH",
        rosterEntryId: ids.entry,
        sourceJobId: ids.job,
      },
    });
  });

  afterAll(async () => {
    await prisma.batch.delete({ where: { id: ids.batch } }).catch(() => {});
    await prisma.exam.delete({ where: { id: ids.exam } }).catch(() => {});
    await prisma.examProgram.delete({ where: { id: ids.program } }).catch(() => {});
    await prisma.$disconnect();
  });

  const cases: [string, () => Promise<{ status: number; body: { code?: string } }>][] = [
    ["ขอลิงก์อัป ZIP", async () => {
      const { POST } = await import("./upload-url/route");
      return call("/upload-url", POST, {}, { batchId: ids.batch, kind: "zip" });
    }],
    ["ขอลิงก์อัปรายชื่อ", async () => {
      const { POST } = await import("./upload-url/route");
      return call("/upload-url", POST, {}, { batchId: ids.batch, kind: "roster" });
    }],
    ["ขอลิงก์อัป PDF รายคน", async () => {
      const { POST } = await import("./upload-url/route");
      return call("/upload-url", POST, {}, { batchId: ids.batch, kind: "pdf" });
    }],
    ["แจ้งอัป ZIP เสร็จ", async () => {
      const { POST } = await import("./batches/[id]/attach/route");
      return call("/attach", POST, { id: ids.batch }, { kind: "zip", key: `sources/${ids.batch}/b.zip` });
    }],
    ["แจ้งอัปรายชื่อเสร็จ", async () => {
      const { POST } = await import("./batches/[id]/attach/route");
      return call("/attach", POST, { id: ids.batch }, { kind: "roster", key: `sources/${ids.batch}/r.xlsx` });
    }],
    ["ใช้รายชื่อชุดใหม่", async () => {
      const { POST } = await import("./batches/[id]/roster/activate/route");
      return call("/activate", POST, { id: ids.batch }, { importId: ids.roster });
    }],
    ["ทิ้งร่างรายชื่อ", async () => {
      const { POST } = await import("./batches/[id]/roster/discard/route");
      return call("/discard", POST, { id: ids.batch }, { importId: ids.roster });
    }],
    ["เพิ่มผู้เข้าสอบ", async () => {
      const { POST } = await import("./batches/[id]/participants/route");
      return call("/participants", POST, { id: ids.batch }, { candidateNo: "9", nameEn: "A B", examMode: "ONLINE" });
    }],
    ["แก้ผู้เข้าสอบ", async () => {
      const { PATCH } = await import("./participants/[entryId]/route");
      return call("/participant", PATCH, { entryId: ids.entry }, { version: 0, examMode: "ONSITE" });
    }],
    ["ลบผู้เข้าสอบที่เพิ่มเอง", async () => {
      const { DELETE } = await import("./participants/[entryId]/route");
      return call("/participant", DELETE, { entryId: ids.manual }, { version: 0 });
    }],
    ["เลือกตัวคน", async () => {
      const { POST } = await import("./participants/[entryId]/identity/route");
      return call("/identity", POST, { entryId: ids.entry }, { action: "NEW", version: 0 });
    }],
    ["แยกเป็นคนใหม่", async () => {
      const { POST } = await import("./participants/[entryId]/separate/route");
      return call("/separate", POST, { entryId: ids.entry }, { version: 0 });
    }],
    ["อัปไฟล์ให้ผู้เข้าสอบ", async () => {
      const { POST } = await import("./participants/[entryId]/certificates/route");
      return call("/certificates", POST, { entryId: ids.entry }, {
        key: `sources/${ids.batch}/p.pdf`, awardCode: "GOLD", purpose: "add",
      });
    }],
    ["ใช้รูปแบบตามรายชื่อ", async () => {
      const { POST } = await import("./pages/[id]/resolve/route");
      return call("/resolve", POST, { id: ids.page }, { action: "USE_ROSTER_MODE", version: 0 });
    }],
    ["ทิ้งหน้า", async () => {
      const { POST } = await import("./pages/[id]/resolve/route");
      return call("/resolve", POST, { id: ids.page }, { action: "DISCARD", version: 0 });
    }],
    ["เปลี่ยนรางวัล", async () => {
      const { POST } = await import("./pages/[id]/resolve/route");
      return call("/resolve", POST, { id: ids.page }, {
        action: "RECLASSIFY", version: 0, awardCode: "SILVER", confirm: true,
      });
    }],
    ["ทิ้งทุกหน้าจากไฟล์ที่อัป", async () => {
      const { POST } = await import("./uploads/[jobId]/discard/route");
      return call("/discard", POST, { jobId: ids.job }, { confirm: "x.zip" });
    }],
    ["เปลี่ยนตัวเลือกใบรางวัลเสริม", async () => {
      const { POST } = await import("./batches/[id]/policy/route");
      return call("/policy", POST, { id: ids.batch }, { policy: "ALL" });
    }],
    ["เผยแพร่ซ้ำระหว่างที่เผยแพร่อยู่", async () => {
      const { POST } = await import("./batches/[id]/publish/route");
      return call("/publish", POST, { id: ids.batch }, { published: true });
    }],
  ];

  for (const [label, run] of cases) {
    it(`รอบที่เผยแพร่อยู่ปฏิเสธ: ${label}`, async () => {
      const { status, body } = await run();
      expect(status).toBe(409);
      expect(body.code).toBe("PUBLISHED");
    });
  }

  it("ยังไม่ได้แตะข้อมูลเลยหลังถูกปฏิเสธทั้งหมด", async () => {
    const page = await prisma.stagingPage.findUniqueOrThrow({ where: { id: ids.page } });
    expect(page.matchStatus).toBe("MODE_MISMATCH");
    expect(page.version).toBe(0);
    expect(await prisma.rosterEntry.count({ where: { batchId: ids.batch } })).toBe(2);
    expect(await prisma.job.count({ where: { batchId: ids.batch } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { batchId: ids.batch } })).toBe(0);
  });

  it("ยกเลิกการเผยแพร่แล้ว จึงแก้ไขได้ และทุกการแก้ไขถูกบันทึก", async () => {
    const { POST: publish } = await import("./batches/[id]/publish/route");
    expect((await call("/publish", publish, { id: ids.batch }, { published: false })).status).toBe(200);

    const { POST: resolve } = await import("./pages/[id]/resolve/route");
    const confirmed = await call("/resolve", resolve, { id: ids.page }, { action: "USE_ROSTER_MODE", version: 0 });
    expect(confirmed.status).toBe(200);

    const page = await prisma.stagingPage.findUniqueOrThrow({ where: { id: ids.page } });
    expect(page.modeConfirmedFor).toBe("ONLINE");
    expect(page.version).toBe(1);
    const actions = (await prisma.auditEvent.findMany({ where: { batchId: ids.batch } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["PUBLICATION_WITHDRAWN", "MODE_MISMATCH_CONFIRMED"]));

    // มีงานจับคู่ค้างอยู่ = ห้ามแก้ต่อจนกว่างานจะเสร็จ
    const busy = await call("/resolve", resolve, { id: ids.page }, { action: "DISCARD", version: 1 });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("BUSY");
  });

  it("แก้ด้วยเวอร์ชันเก่า (อีกแท็บแก้ไปก่อน) ต้องถูกปฏิเสธ ไม่เขียนทับเงียบ ๆ", async () => {
    await prisma.job.updateMany({ where: { batchId: ids.batch, status: "QUEUED" }, data: { status: "DONE" } });
    const { PATCH } = await import("./participants/[entryId]/route");
    const first = await call("/participant", PATCH, { entryId: ids.entry }, { version: 0, level: "PRIMARY 3" });
    expect(first.status).toBe(200);
    await prisma.job.updateMany({ where: { batchId: ids.batch, status: "QUEUED" }, data: { status: "DONE" } });
    const stale = await call("/participant", PATCH, { entryId: ids.entry }, { version: 0, level: "PRIMARY 4" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE");
  });

  it("เลขผู้เข้าสอบซ้ำไม่ได้ ทั้ง online และ onsite", async () => {
    const { POST } = await import("./batches/[id]/participants/route");
    await prisma.batch.update({ where: { id: ids.batch }, data: { activeRosterImportId: ids.roster } });
    const duplicate = await call("/participants", POST, { id: ids.batch }, {
      candidateNo: "1", nameEn: "OTHER PERSON", examMode: "ONSITE",
    });
    expect(duplicate.status).toBe(409);
  });
});
