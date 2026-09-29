import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { withBatchMutation } from "@/lib/batch-guard";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { loadEntry, separateStudent, updateEntry } from "@/lib/participants";

const schema = z.object({ version: z.number().int() });

/**
 * แยกผู้เข้าสอบคนนี้ออกจากตัวคนที่ผูกอยู่ ไปเป็นคนใหม่
 *
 * ใช้เมื่อระบบรวมคนละคนที่ชื่อเหมือนกันเข้าด้วยกันผิด — ห้ามแก้ด้วยการเปลี่ยนชื่อตัวคนเดิม
 * เพราะเกียรติบัตรปีก่อน ๆ ของคนเดิมจะเปลี่ยนชื่อตามไปด้วย
 */
export const POST = adminHandler<{ entryId: string }>(async (request, { params, session }) => {
  const { version } = await parseBody(request, schema);
  const found = await prisma.rosterEntry.findUnique({ where: { id: params.entryId }, select: { batchId: true } });
  if (!found) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนนี้ในรายชื่อ");

  const student = await withBatchMutation(found.batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId, version);
    if (!entry.studentId) throw new HttpError(409, "ผู้เข้าสอบคนนี้ยังไม่ได้ผูกกับใคร ไม่มีอะไรให้แยก");
    const created = await separateStudent(tx, entry);
    await updateEntry(tx, entry, { studentId: created.id, studentLinkedManually: true });
    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY",
      entityId: entry.id,
      action: "STUDENT_SEPARATED",
      before: { studentId: entry.studentId },
      after: { studentId: created.id },
      sessionId: session.sessionId,
    });
    return created;
  });

  return NextResponse.json({ ok: true, studentId: student.id });
});
