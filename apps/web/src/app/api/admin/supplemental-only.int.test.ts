/** ทดสอบการยืนยันรางวัลเสริมกับ DB แยกเท่านั้น — ห้ามใช้ฐานข้อมูลจริง */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ sessionId: "supplemental-test" }) }));
vi.mock("@/lib/worker", () => ({ wakeWorker: async () => true }));

describe.skipIf(!url || url.endsWith("/ocec"))("ยืนยันใช้เฉพาะรางวัลเสริมที่มีอยู่", async () => {
  const { prisma } = await import("@/lib/db");
  const { loadParticipants } = await import("@/lib/publish");
  const { decidePublish } = await import("@/lib/publish-rules");
  const { POST: approve } = await import("./participants/[entryId]/supplemental-only/route");
  const { POST: publish } = await import("./batches/[id]/publish/route");

  let fixture: {
    programId: string; examId: string; batchId: string; entryId: string;
    studentId: string; certificateId: string;
  } | null = null;

  async function call(action: "APPROVE" | "REVOKE", version: number) {
    const response = await approve(
      new Request("http://test/supplemental-only", {
        method: "POST", body: JSON.stringify({ action, version }),
      }),
      { params: Promise.resolve({ entryId: fixture!.entryId }) },
    );
    return { status: response.status, body: await response.json() };
  }

  async function decision(policy: "ALL" | "MEDAL_ONLY" = "ALL") {
    const f = fixture!;
    const participants = await loadParticipants(prisma, { id: f.batchId, programCode: "HKIMO", round: "FINAL" });
    return decidePublish(participants, policy);
  }

  beforeEach(async () => {
    const program = await prisma.examProgram.create({
      data: { id: randomUUID(), code: "HKIMO", name: "Synthetic HKIMO" },
    });
    const exam = await prisma.exam.create({ data: { programId: program.id, year: 2092, round: "FINAL" } });
    const batch = await prisma.batch.create({
      data: { examId: exam.id, status: "READY", profileKey: "HKIMO_FINAL" },
    });
    const roster = await prisma.rosterImport.create({
      data: { batchId: batch.id, sourceKey: "synthetic/roster.xlsx", status: "ACTIVE" },
    });
    await prisma.batch.update({ where: { id: batch.id }, data: { activeRosterImportId: roster.id } });
    const student = await prisma.student.create({
      data: { nameEn: "SOMCHAI JAIDEE", nameEnNormalized: "SOMCHAI JAIDEE" },
    });
    const entry = await prisma.rosterEntry.create({
      data: {
        batchId: batch.id, rosterImportId: roster.id, studentId: student.id,
        candidateNo: "9002", nameEn: "SOMCHAI JAIDEE", nameEnNormalized: "SOMCHAI JAIDEE",
        examMode: "ONLINE", source: "EXCEL",
      },
    });
    const page = await prisma.stagingPage.create({
      data: {
        batchId: batch.id, pageNumber: 1, rawText: "synthetic supplemental certificate",
        award: "PERFECT_SCORE", matchStatus: "MATCHED", rosterEntryId: entry.id,
        matchedStudentId: student.id,
      },
    });
    const certificate = await prisma.certificate.create({
      data: {
        batchId: batch.id, examId: exam.id, studentId: student.id,
        rosterEntryId: entry.id, stagingPageId: page.id, award: "PERFECT_SCORE",
        pdfKey: "synthetic/perfect-score.pdf", pageNumber: 1,
      },
    });
    fixture = {
      programId: program.id, examId: exam.id, batchId: batch.id,
      entryId: entry.id, studentId: student.id, certificateId: certificate.id,
    };
  });

  afterEach(async () => {
    if (!fixture) return;
    await prisma.batch.delete({ where: { id: fixture.batchId } });
    await prisma.exam.delete({ where: { id: fixture.examId } });
    await prisma.examProgram.delete({ where: { id: fixture.programId } });
    await prisma.student.delete({ where: { id: fixture.studentId } });
    fixture = null;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("พักใบไว้ก่อน ยืนยันแล้วเผยแพร่ได้จริง และยกเลิกการยืนยันได้", async () => {
    const f = fixture!;
    expect((await decision()).heldParticipants[0].reason).toBe("MISSING_PRIMARY");
    expect((await call("APPROVE", 0)).status).toBe(200);
    expect((await decision("MEDAL_ONLY")).publish).toEqual([f.certificateId]);
    const response = await publish(
      new Request("http://test/publish", { method: "POST", body: JSON.stringify({ published: true }) }),
      { params: Promise.resolve({ id: f.batchId }) },
    );
    expect(response.status).toBe(200);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: f.certificateId } })).published).not.toBeNull();
    await prisma.batch.update({ where: { id: f.batchId }, data: { status: "READY" } });
    await prisma.job.updateMany({ where: { batchId: f.batchId, status: "QUEUED" }, data: { status: "DONE" } });
    expect((await call("REVOKE", 1)).status).toBe(200);
    expect((await decision()).heldParticipants[0].reason).toBe("MISSING_PRIMARY");
    expect(await prisma.auditEvent.count({
      where: { batchId: f.batchId, action: { in: ["SUPPLEMENTAL_ONLY_APPROVED", "SUPPLEMENTAL_ONLY_REVOKED"] } },
    })).toBe(2);
  });

  it("เมื่อไฟล์ใบเดิมถูกเปลี่ยน การยืนยันหมดผลจนกว่าจะตรวจชุดใหม่", async () => {
    const f = fixture!;
    expect((await call("APPROVE", 0)).status).toBe(200);
    await prisma.certificate.update({ where: { id: f.certificateId }, data: { pdfKey: "synthetic/replaced.pdf" } });
    expect((await decision()).heldParticipants[0].reason).toBe("MISSING_PRIMARY");
    expect((await call("APPROVE", 1)).status).toBe(200);
    expect((await decision()).publish).toEqual([f.certificateId]);
  });

  it("เพิ่ม Gold ภายหลังแล้วใช้ตัวเลือก ALL/MEDAL_ONLY ของรอบตามเดิม", async () => {
    const f = fixture!;
    expect((await call("APPROVE", 0)).status).toBe(200);
    const page = await prisma.stagingPage.create({
      data: {
        batchId: f.batchId, pageNumber: 2, rawText: "synthetic gold certificate",
        award: "GOLD", matchStatus: "MATCHED", rosterEntryId: f.entryId,
        matchedStudentId: f.studentId,
      },
    });
    const gold = await prisma.certificate.create({
      data: {
        batchId: f.batchId, examId: f.examId, studentId: f.studentId,
        rosterEntryId: f.entryId, stagingPageId: page.id, award: "GOLD",
        pdfKey: "synthetic/gold.pdf", pageNumber: 2,
      },
    });
    expect((await decision("ALL")).publish).toEqual([f.certificateId, gold.id]);
    expect((await decision("MEDAL_ONLY")).publish).toEqual([gold.id]);
  });

  it("ไม่ยืนยันขณะมีปัญหาหน้าอื่นค้าง แม้มี Perfect Score แล้ว", async () => {
    const f = fixture!;
    await prisma.stagingPage.create({
      data: {
        batchId: f.batchId, pageNumber: 2, rawText: "synthetic unresolved page",
        matchStatus: "MODE_MISMATCH", rosterEntryId: f.entryId,
      },
    });
    expect((await call("APPROVE", 0)).status).toBe(409);
    expect((await decision()).heldParticipants[0].reason).toBe("MODE_MISMATCH");
  });

  it("ไม่ยืนยันเมื่อยังมีหน้า UNMATCHED ที่ระบุเลขผู้เข้าสอบคนนี้ได้", async () => {
    const f = fixture!;
    await prisma.stagingPage.create({
      data: {
        batchId: f.batchId, pageNumber: 2, rawText: "synthetic unmatched page",
        matchStatus: "UNMATCHED", certNo: "9002",
      },
    });
    expect((await call("APPROVE", 0)).status).toBe(409);
  });

  it("รอบที่เผยแพร่อยู่และข้อมูลเวอร์ชันเก่าแก้ไม่ได้", async () => {
    const f = fixture!;
    expect((await call("APPROVE", 0)).status).toBe(200);
    expect((await call("REVOKE", 0)).status).toBe(409);
    await prisma.batch.update({ where: { id: f.batchId }, data: { status: "PUBLISHED" } });
    const response = await call("REVOKE", 1);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PUBLISHED");
  });
});
