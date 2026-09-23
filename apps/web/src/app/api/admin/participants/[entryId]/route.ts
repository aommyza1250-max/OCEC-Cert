import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueueRematch, revalidateDraft, withBatchMutation } from "@/lib/batch-guard";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { normalizeName } from "@/lib/normalize";
import {
  assertCandidateNoFree,
  derivedFields,
  historyOutsideBatch,
  loadEntry,
  normalizeCandidateNo,
  releasePages,
  requireUsableName,
  separateStudent,
  snapshot,
  updateEntry,
} from "@/lib/participants";

const optional = z.string().trim().max(300).optional().transform((v) => (v === undefined ? undefined : v || null));
const patchSchema = z.object({
  version: z.number().int(),
  candidateNo: z.string().optional(),
  nameEn: optional,
  nameTh: optional,
  examMode: z.enum(["ONLINE", "ONSITE"]).optional(),
  school: optional,
  level: optional,
  /** ตัวคนนี้มีเกียรติบัตรรายการอื่นด้วย: แก้ชื่อตัวคนทั้งหมด หรือแยกคนนี้ออกเป็นคนใหม่ */
  studentAction: z.enum(["RENAME_STUDENT", "SEPARATE"]).optional(),
});

async function batchOf(entryId: string) {
  const entry = await prisma.rosterEntry.findUnique({ where: { id: entryId }, select: { batchId: true } });
  if (!entry) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนนี้ในรายชื่อ — อาจถูกลบไปแล้ว");
  return entry.batchId;
}

/**
 * แก้ข้อมูลผู้เข้าสอบ (ได้เฉพาะตอนยังไม่เผยแพร่)
 *
 * - เลขเปลี่ยน: ต้องไม่ซ้ำ แล้วจับคู่ใหม่ (หน้าที่เคยจับด้วยเลขเดิมจะหลุด หน้าของเลขใหม่จะเข้ามา)
 * - รูปแบบการสอบเปลี่ยน: ตรวจทุกหน้าของคนนี้ใหม่
 * - ชื่อเปลี่ยน: คำนวณชื่อมาตรฐานใหม่ และตรวจชื่อบนเกียรติบัตรใหม่
 *   ถ้าตัวคนนี้มีเกียรติบัตรรายการอื่นด้วย ต้องเลือกว่าจะแก้ชื่อตัวคน (มีผลทุกใบ) หรือแยกเป็นคนใหม่
 *   — ถ้าผูกผิดคนมาตั้งแต่แรก ต้องแยก ไม่ใช่เปลี่ยนชื่อคนเดิมให้กลายเป็นคนนี้
 */
export const PATCH = adminHandler<{ entryId: string }>(async (request, { params, session }) => {
  const input = await parseBody(request, patchSchema);
  const batchId = await batchOf(params.entryId);

  await withBatchMutation(batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId, input.version);
    const next = {
      candidateNo: input.candidateNo !== undefined ? normalizeCandidateNo(input.candidateNo) : entry.candidateNo,
      nameEn: input.nameEn !== undefined ? input.nameEn : entry.nameEn,
      nameTh: input.nameTh !== undefined ? input.nameTh : entry.nameTh,
      examMode: input.examMode ?? entry.examMode,
      school: input.school !== undefined ? input.school : entry.school,
      level: input.level !== undefined ? input.level : entry.level,
    };
    requireUsableName(next.nameEn, next.nameTh);
    if (next.candidateNo !== entry.candidateNo) {
      await assertCandidateNoFree(tx, batch.id, next.candidateNo, entry.id);
    }

    const namesChanged =
      normalizeName(next.nameEn) !== normalizeName(entry.nameEn) ||
      normalizeName(next.nameTh) !== normalizeName(entry.nameTh);
    await updateEntry(tx, entry, { ...next, ...derivedFields(next) });
    const updated = { ...entry, ...next };

    if (namesChanged && entry.studentId) {
      const others = await historyOutsideBatch(tx, entry.studentId, batch.id);
      if (others > 0 && !input.studentAction) {
        throw new HttpError(
          409,
          `ผู้เข้าสอบคนนี้มีเกียรติบัตรรายการอื่นอีก ${others} ใบ — เลือกก่อนว่าจะแก้ชื่อทุกใบ หรือแยกเป็นคนใหม่`,
          { code: "STUDENT_HISTORY", otherCertificates: others },
        );
      }
      if (input.studentAction === "SEPARATE") {
        const student = await separateStudent(tx, updated);
        await tx.rosterEntry.update({
          where: { id: entry.id },
          data: { studentId: student.id, studentLinkedManually: true },
        });
        await recordAudit(tx, batch, {
          entityType: "ROSTER_ENTRY", entityId: entry.id, action: "STUDENT_SEPARATED",
          before: { studentId: entry.studentId }, after: { studentId: student.id },
          sessionId: session.sessionId,
        });
      } else {
        const before = await tx.student.findUniqueOrThrow({ where: { id: entry.studentId } });
        await tx.student.update({
          where: { id: entry.studentId },
          data: { nameEn: next.nameEn, nameTh: next.nameTh, ...stripSchool(derivedFields(next)) },
        });
        if (others > 0) {
          await recordAudit(tx, batch, {
            entityType: "ROSTER_ENTRY", entityId: entry.id, action: "STUDENT_RENAMED",
            before: { studentId: before.id, nameEn: before.nameEn, nameTh: before.nameTh },
            after: { studentId: before.id, nameEn: next.nameEn, nameTh: next.nameTh, otherCertificates: others },
            sessionId: session.sessionId,
          });
        }
      }
    }

    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY",
      entityId: entry.id,
      action: "ROSTER_ENTRY_UPDATED",
      before: snapshot(entry),
      after: snapshot({ ...entry, ...next }),
      sessionId: session.sessionId,
    });
    await enqueueRematch(tx, batch.id);
    if (entry.source === "MANUAL") await revalidateDraft(tx, batch.id);
  });

  await afterCommit();
  return NextResponse.json({ ok: true });
});

function stripSchool<T extends { schoolNormalized: unknown }>(fields: T) {
  // โรงเรียนของตัวคนไม่แก้ตามรายชื่อรอบนี้ — ปีก่อนอาจอยู่คนละโรงเรียนจริง
  const { schoolNormalized: _school, ...rest } = fields;
  return rest;
}

const deleteSchema = z.object({ version: z.number().int() });

/**
 * ลบผู้เข้าสอบที่แอดมินเพิ่มเอง — รายการจาก Excel ลบที่นี่ไม่ได้ (ต้องอัป Excel ชุดใหม่แทน)
 * หน้าที่เคยผูกกับคนนี้กลับไปรอจับคู่ใหม่ ใบที่ออกไปแล้วถูกลบตาม
 */
export const DELETE = adminHandler<{ entryId: string }>(async (request, { params, session }) => {
  const { version } = await parseBody(request, deleteSchema);
  const batchId = await batchOf(params.entryId);

  await withBatchMutation(batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId, version);
    if (entry.source !== "MANUAL") {
      throw new HttpError(409, "ผู้เข้าสอบคนนี้มาจากไฟล์ Excel — ถ้าไม่ควรอยู่ในรายชื่อ ให้แก้ Excel แล้วอัปใหม่");
    }
    await releasePages(tx, entry.id);
    await tx.rosterEntry.delete({ where: { id: entry.id } });
    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY",
      entityId: entry.id,
      action: "ROSTER_ENTRY_DELETED",
      before: snapshot(entry),
      sessionId: session.sessionId,
    });
    await enqueueRematch(tx, batch.id);
    await revalidateDraft(tx, batch.id);
  });

  await afterCommit();
  return NextResponse.json({ ok: true });
});
