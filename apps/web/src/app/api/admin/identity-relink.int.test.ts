/** แก้การเลือก "คนใหม่" ผิดโดยไม่แตะใบของรอบอื่น — รันเฉพาะบน TEST_DATABASE_URL */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ sessionId: "identity-test" }) }));
vi.mock("@/lib/worker", () => ({ wakeWorker: async () => true }));

describe.skipIf(!url || url.endsWith("/ocec"))("เปลี่ยนตัวคนที่ผูก", async () => {
  const { prisma } = await import("@/lib/db");
  const { POST } = await import("./participants/[entryId]/identity/route");
  const { POST: separate } = await import("./participants/[entryId]/separate/route");
  type Fixture = {
    programId: string;
    heatExamId: string;
    finalExamId: string;
    heatBatchId: string;
    finalBatchId: string;
    entryId: string;
    targetId: string;
    heatCertificateId: string;
    oldId?: string;
  };
  let fixture: Fixture | null = null;

  async function call(entryId: string, body: object) {
    const response = await POST(
      new Request("http://test/identity", { method: "POST", body: JSON.stringify(body) }),
      { params: Promise.resolve({ entryId }) },
    );
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    const programId = randomUUID();
    const code = `T${programId.slice(0, 6).toUpperCase()}`;
    const program = await prisma.examProgram.create({ data: { id: programId, code, name: "Synthetic Program" } });
    const heat = await prisma.exam.create({ data: { programId: program.id, round: "HEAT", year: 2092 } });
    const final = await prisma.exam.create({ data: { programId: program.id, round: "FINAL", year: 2092 } });
    const heatBatch = await prisma.batch.create({ data: { examId: heat.id, status: "READY", profileKey: "HKIMO_HEAT" } });
    const finalBatch = await prisma.batch.create({ data: { examId: final.id, status: "READY", profileKey: "HKIMO_FINAL" } });
    const target = await prisma.student.create({
      data: { nameEn: "SOMCHAI JAIDEE", nameEnNormalized: "SOMCHAI JAIDEE", school: "SAMPLE SCHOOL" },
    });
    const heatEntry = await prisma.rosterEntry.create({
      data: {
        batchId: heatBatch.id, candidateNo: "9001", nameEn: "SOMCHAI JAIDEE",
        nameEnNormalized: "SOMCHAI JAIDEE", school: "SAMPLE SCHOOL",
        examMode: "ONLINE", source: "EXCEL", studentId: target.id,
      },
    });
    const finalEntry = await prisma.rosterEntry.create({
      data: {
        batchId: finalBatch.id, candidateNo: "9002", nameEn: "SOMCHAI JAIDEE",
        nameEnNormalized: "SOMCHAI JAIDEE", school: "SAMPLE SCHOOL",
        examMode: "ONLINE", source: "EXCEL",
      },
    });
    const heatPage = await prisma.stagingPage.create({
      data: {
        batchId: heatBatch.id, pageNumber: 1, rawText: "synthetic heat",
        award: "BRONZE", matchStatus: "MATCHED", rosterEntryId: heatEntry.id,
        matchedStudentId: target.id,
      },
    });
    const heatCertificate = await prisma.certificate.create({
      data: {
        studentId: target.id, examId: heat.id, batchId: heatBatch.id,
        stagingPageId: heatPage.id, rosterEntryId: heatEntry.id,
        pdfKey: "synthetic/heat.pdf", pageNumber: 1, award: "BRONZE", published: new Date(),
      },
    });
    fixture = {
      programId, heatExamId: heat.id, finalExamId: final.id,
      heatBatchId: heatBatch.id, finalBatchId: finalBatch.id,
      entryId: finalEntry.id, targetId: target.id, heatCertificateId: heatCertificate.id,
    };
  });

  afterEach(async () => {
    if (!fixture) return;
    await prisma.batch.deleteMany({ where: { id: { in: [fixture.heatBatchId, fixture.finalBatchId] } } });
    await prisma.exam.deleteMany({ where: { id: { in: [fixture.heatExamId, fixture.finalExamId] } } });
    await prisma.examProgram.deleteMany({ where: { id: fixture.programId } });
    await prisma.student.deleteMany({ where: { id: { in: [fixture.targetId, ...(fixture.oldId ? [fixture.oldId] : [])] } } });
    fixture = null;
  });

  afterAll(async () => { await prisma.$disconnect(); });

  async function addFinalCertificate(studentId: string) {
    const f = fixture!;
    const page = await prisma.stagingPage.create({
      data: {
        batchId: f.finalBatchId, pageNumber: 1, rawText: "synthetic final",
        award: "MERIT", matchStatus: "MATCHED", rosterEntryId: f.entryId,
        matchedStudentId: studentId,
      },
    });
    return prisma.certificate.create({
      data: {
        studentId, examId: f.finalExamId, batchId: f.finalBatchId,
        stagingPageId: page.id, rosterEntryId: f.entryId,
        pdfKey: "synthetic/final.pdf", pageNumber: 1, award: "MERIT",
      },
    });
  }

  async function chooseNew() {
    const f = fixture!;
    expect((await call(f.entryId, { action: "NEW", version: 0 })).status).toBe(200);
    const entry = await prisma.rosterEntry.findUniqueOrThrow({ where: { id: f.entryId } });
    f.oldId = entry.studentId!;
    await prisma.job.updateMany({ where: { batchId: f.finalBatchId, status: "QUEUED" }, data: { status: "DONE" } });
    return entry;
  }

  it("ย้ายใบ FINAL ไปคนเดิม และลบระเบียนคนใหม่ที่ไม่มีใครใช้ โดยใบ HEAT คงเดิม", async () => {
    const f = fixture!;
    await chooseNew();
    const finalCertificate = await addFinalCertificate(f.oldId!);
    const result = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 1 });

    expect(result.status).toBe(200);
    expect(result.body.oldStudentDeleted).toBe(true);
    expect(await prisma.student.findUnique({ where: { id: f.oldId! } })).toBeNull();
    expect((await prisma.rosterEntry.findUniqueOrThrow({ where: { id: f.entryId } })).studentId).toBe(f.targetId);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: finalCertificate.id } })).studentId).toBe(f.targetId);
    expect((await prisma.stagingPage.findUniqueOrThrow({ where: { id: finalCertificate.stagingPageId } })).matchedStudentId).toBe(f.targetId);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: f.heatCertificateId } })).studentId).toBe(f.targetId);
    expect(await prisma.auditEvent.count({ where: { batchId: f.finalBatchId, action: "STUDENT_LINKED" } })).toBe(2);
  });

  it("ไม่ลบคนใหม่เมื่อยังมีรายการอื่นอ้างอิง และแจ้งว่าเก็บไว้", async () => {
    const f = fixture!;
    await chooseNew();
    await addFinalCertificate(f.oldId!);
    await prisma.rosterEntry.create({
      data: {
        batchId: f.heatBatchId, candidateNo: "9003", nameEn: "SOMCHAI JAIDEE",
        nameEnNormalized: "SOMCHAI JAIDEE", examMode: "ONSITE", source: "MANUAL", studentId: f.oldId,
      },
    });
    const result = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 1 });
    expect(result.status).toBe(200);
    expect(result.body.cleanupBlocked).toBe(true);
    expect(await prisma.student.findUnique({ where: { id: f.oldId! } })).not.toBeNull();
  });

  it("ย้ายกลับได้หลังเผลอกดแยกเป็นคนใหม่ และลบตัวคนที่แยกเกินมา", async () => {
    const f = fixture!;
    await prisma.rosterEntry.update({ where: { id: f.entryId }, data: { studentId: f.targetId } });
    const finalCertificate = await addFinalCertificate(f.targetId);
    const response = await separate(
      new Request("http://test/separate", { method: "POST", body: JSON.stringify({ version: 0 }) }),
      { params: Promise.resolve({ entryId: f.entryId }) },
    );
    expect(response.status).toBe(200);
    f.oldId = (await prisma.rosterEntry.findUniqueOrThrow({ where: { id: f.entryId } })).studentId!;
    expect(f.oldId).not.toBe(f.targetId);

    const corrected = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 1 });
    expect(corrected.status).toBe(200);
    expect(corrected.body.oldStudentDeleted).toBe(true);
    expect(await prisma.student.findUnique({ where: { id: f.oldId! } })).toBeNull();
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: finalCertificate.id } })).studentId).toBe(f.targetId);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: f.heatCertificateId } })).studentId).toBe(f.targetId);
  });

  it("ไม่ลบตัวคนที่ไม่ได้สร้างจากการกดคนใหม่ แม้ย้ายการผูกแล้วไม่มีใครใช้อยู่", async () => {
    const f = fixture!;
    const old = await prisma.student.create({ data: { nameEn: "SOMCHAI JAIDEE", nameEnNormalized: "SOMCHAI JAIDEE" } });
    f.oldId = old.id;
    await prisma.rosterEntry.update({ where: { id: f.entryId }, data: { studentId: old.id, studentLinkedManually: true } });
    await addFinalCertificate(old.id);
    const result = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 1 });
    expect(result.status).toBe(409);
    const corrected = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 0 });
    expect(corrected.status).toBe(200);
    expect(corrected.body.oldStudentDeleted).toBe(false);
    expect(await prisma.student.findUnique({ where: { id: old.id } })).not.toBeNull();
  });

  it("ไม่ยอมผูกกับคนชื่อไม่ตรง หรือคนที่มีผู้เข้าสอบคนอื่นในรอบนี้ใช้แล้ว", async () => {
    const f = fixture!;
    await chooseNew();
    const stranger = await prisma.student.create({ data: { nameEn: "MALEE JAIDEE", nameEnNormalized: "MALEE JAIDEE" } });
    try {
      const wrong = await call(f.entryId, { action: "LINK", studentId: stranger.id, version: 1 });
      expect(wrong.status).toBe(409);
      await prisma.rosterEntry.create({
        data: {
          batchId: f.finalBatchId, candidateNo: "9004", nameEn: "SOMCHAI JAIDEE",
          nameEnNormalized: "SOMCHAI JAIDEE", examMode: "ONSITE", source: "MANUAL", studentId: f.targetId,
        },
      });
      const taken = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 1 });
      expect(taken.status).toBe(409);
      expect((await prisma.rosterEntry.findUniqueOrThrow({ where: { id: f.entryId } })).studentId).toBe(f.oldId);
    } finally {
      await prisma.student.delete({ where: { id: stranger.id } });
    }
  });

  it("การผูกครั้งแรกยังใช้ตัวเลือกเดิมได้ แม้ชื่อที่ normalize ต่างกัน", async () => {
    const f = fixture!;
    const student = await prisma.student.create({
      data: { nameEn: "SOMCHAI J.", nameEnNormalized: "SOMCHAI J" },
    });
    try {
      const result = await call(f.entryId, { action: "LINK", studentId: student.id, version: 0 });
      expect(result.status).toBe(200);
      expect((await prisma.rosterEntry.findUniqueOrThrow({ where: { id: f.entryId } })).studentId).toBe(student.id);
    } finally {
      await prisma.student.delete({ where: { id: student.id } });
    }
  });

  it("รอบที่เผยแพร่อยู่ไม่ยอมย้ายการผูก", async () => {
    const f = fixture!;
    await chooseNew();
    await prisma.batch.update({ where: { id: f.finalBatchId }, data: { status: "PUBLISHED" } });
    const result = await call(f.entryId, { action: "LINK", studentId: f.targetId, version: 1 });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("PUBLISHED");
    expect((await prisma.rosterEntry.findUniqueOrThrow({ where: { id: f.entryId } })).studentId).toBe(f.oldId);
  });
});
