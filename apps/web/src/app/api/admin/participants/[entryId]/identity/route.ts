import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueueRematch, withBatchMutation } from "@/lib/batch-guard";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { derivedFields, loadEntry, updateEntry } from "@/lib/participants";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("LINK"), studentId: z.string().uuid(), version: z.number().int() }),
  z.object({ action: z.literal("NEW"), version: z.number().int() }),
]);

/**
 * ตัดสินว่าผู้เข้าสอบคนนี้คือใคร — ใช้เมื่อระบบแยกคนชื่อพ้องไม่ออกและไม่ยอมเดา
 *
 *   LINK — คนเดิมที่มีอยู่แล้วในระบบ (ใบของปีก่อน ๆ จะรวมอยู่ด้วยกันบนหน้าค้นหา)
 *   NEW  — คนใหม่ที่บังเอิญชื่อเหมือนคนเดิม
 */
export const POST = adminHandler<{ entryId: string }>(async (request, { params, session }) => {
  const input = await parseBody(request, schema);
  const found = await prisma.rosterEntry.findUnique({ where: { id: params.entryId }, select: { batchId: true } });
  if (!found) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนนี้ในรายชื่อ");

  const result = await withBatchMutation(found.batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId, input.version);
    let studentId: string;
    if (input.action === "LINK") {
      const student = await tx.student.findUnique({ where: { id: input.studentId } });
      if (!student) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนที่เลือก");
      if (entry.studentId === student.id) throw new HttpError(409, "ผู้เข้าสอบผูกกับคนนี้อยู่แล้ว");
      const entryNames = [entry.nameEnNormalized, entry.nameThNormalized].filter(Boolean);
      if (entry.studentId && !entryNames.some((name) => name === student.nameEnNormalized || name === student.nameThNormalized)) {
        throw new HttpError(409, "ชื่อคนที่เลือกไม่ตรงกับรายชื่อ — ตรวจชื่อให้ถูกก่อนเปลี่ยนตัวคน");
      }
      // ผู้เข้าสอบ 2 คนในรอบเดียวกันเป็นคนละคนเสมอ (เลขไม่ซ้ำกัน) จะผูกกับตัวคนเดียวกันไม่ได้
      const taken = await tx.rosterEntry.findFirst({
        where: { batchId: batch.id, studentId: student.id, id: { not: entry.id } },
        select: { candidateNo: true },
      });
      if (taken) throw new HttpError(409, `คนที่เลือกผูกกับผู้เข้าสอบเลข ${taken.candidateNo} ในรอบนี้แล้ว`);
      studentId = student.id;
    } else {
      if (entry.studentId) throw new HttpError(409, "ผู้เข้าสอบผูกกับตัวคนแล้ว — ใช้การเปลี่ยนตัวคนแทนการสร้างใหม่");
      const student = await tx.student.create({
        data: { nameEn: entry.nameEn, nameTh: entry.nameTh, school: entry.school, ...derivedFields(entry) },
      });
      studentId = student.id;
    }

    // ลบได้เฉพาะระเบียนที่แอดมินสร้างจาก "คนใหม่" / "แยกเป็นคนใหม่" ให้รายการนี้จริง ๆ
    // ระเบียนจากรอบอื่น แม้หลังย้ายแล้วไม่มีใบ ก็ห้ามลบเพราะไม่มีหลักฐานว่าเป็นข้อมูลพลาด
    const oldId = entry.studentId;
    let createdHere = false;
    if (oldId && oldId !== studentId) {
      const events = await tx.auditEvent.findMany({
        where: {
          batchId: batch.id, entityType: "ROSTER_ENTRY", entityId: entry.id,
          action: { in: ["STUDENT_LINKED", "STUDENT_SEPARATED"] },
          after: { path: ["studentId"], equals: oldId },
        },
        select: { action: true, after: true },
      });
      createdHere = events.some((event) => {
        const after = event.after as { action?: unknown } | null;
        return event.action === "STUDENT_SEPARATED" || (event.action === "STUDENT_LINKED" && after?.action === "NEW");
      });
      if (createdHere) {
        // งานของอีกรอบอาจผูกตัวคนนี้พร้อมกัน — ล็อกแถวก่อนตรวจว่าไม่มีใครใช้อยู่
        await tx.$queryRaw`SELECT id FROM students WHERE id = ${oldId}::uuid FOR UPDATE`;
      }
    }

    await updateEntry(tx, entry, { studentId, studentLinkedManually: true });
    await tx.certificate.updateMany({ where: { batchId: batch.id, rosterEntryId: entry.id }, data: { studentId } });
    if (oldId) {
      await tx.stagingPage.updateMany({
        where: { batchId: batch.id, rosterEntryId: entry.id, matchedStudentId: oldId, matchStatus: "MATCHED" },
        data: { matchedStudentId: studentId },
      });
    }
    let oldStudentDeleted = false;
    if (oldId && createdHere) {
      const deleted = await tx.student.deleteMany({
        where: {
          id: oldId,
          rosterEntries: { none: {} }, certificates: { none: {} }, stagingPages: { none: {} },
        },
      });
      oldStudentDeleted = deleted.count === 1;
    }
    const cleanupBlocked = createdHere && !oldStudentDeleted;
    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY",
      entityId: entry.id,
      action: "STUDENT_LINKED",
      before: { studentId: entry.studentId },
      after: { studentId, action: input.action, oldStudentDeleted, cleanupBlocked },
      sessionId: session.sessionId,
    });
    await enqueueRematch(tx, batch.id);
    return { oldStudentDeleted, cleanupBlocked };
  });

  await afterCommit();
  return NextResponse.json({ ok: true, ...result });
});
