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

  await withBatchMutation(found.batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId, input.version);
    let studentId: string;
    if (input.action === "LINK") {
      const student = await tx.student.findUnique({ where: { id: input.studentId } });
      if (!student) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนที่เลือก");
      // ผู้เข้าสอบ 2 คนในรอบเดียวกันเป็นคนละคนเสมอ (เลขไม่ซ้ำกัน) จะผูกกับตัวคนเดียวกันไม่ได้
      const taken = await tx.rosterEntry.findFirst({
        where: { batchId: batch.id, studentId: student.id, id: { not: entry.id } },
        select: { candidateNo: true },
      });
      if (taken) throw new HttpError(409, `คนที่เลือกผูกกับผู้เข้าสอบเลข ${taken.candidateNo} ในรอบนี้แล้ว`);
      studentId = student.id;
    } else {
      const student = await tx.student.create({
        data: { nameEn: entry.nameEn, nameTh: entry.nameTh, school: entry.school, ...derivedFields(entry) },
      });
      studentId = student.id;
    }

    await updateEntry(tx, entry, { studentId, studentLinkedManually: true });
    await tx.certificate.updateMany({ where: { rosterEntryId: entry.id }, data: { studentId } });
    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY",
      entityId: entry.id,
      action: "STUDENT_LINKED",
      before: { studentId: entry.studentId },
      after: { studentId, action: input.action },
      sessionId: session.sessionId,
    });
    await enqueueRematch(tx, batch.id);
  });

  await afterCommit();
  return NextResponse.json({ ok: true });
});
