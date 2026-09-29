import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueueRematch, revalidateDraft, withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, parseBody } from "@/lib/http";
import {
  assertCandidateNoFree,
  derivedFields,
  normalizeCandidateNo,
  requireUsableName,
  snapshot,
} from "@/lib/participants";

const optional = z.string().trim().max(300).optional().transform((v) => v || null);
const schema = z.object({
  candidateNo: z.string().min(1, "กรุณากรอกเลขผู้เข้าสอบ"),
  nameEn: optional,
  nameTh: optional,
  examMode: z.enum(["ONLINE", "ONSITE"], { message: "กรุณาเลือกรูปแบบการสอบ" }),
  school: optional,
  level: optional,
  /** รางวัลที่คาดไว้ (ถ้ารู้) — ใช้ตามเก็บไฟล์ที่ขาดเท่านั้น ไม่ใช้ตัดสินรางวัลของใบ */
  rawAward: optional,
});

/**
 * เพิ่มผู้เข้าสอบที่ตกหล่นจาก Excel ด้วยมือ
 *
 * รายการนี้รอดจากการอัป Excel ชุดใหม่เสมอ (เว้นแต่แอดมินเลือกรวมกับแถวใน Excel เอง)
 * เพิ่มแล้วจับคู่ใหม่ทันที หน้าที่รอผู้เข้าสอบเลขนี้อยู่จะจับคู่เอง
 */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const input = await parseBody(request, schema);
  requireUsableName(input.nameEn, input.nameTh);
  const candidateNo = normalizeCandidateNo(input.candidateNo);

  const entry = await withBatchMutation(
    params.id,
    async (tx, batch) => {
      await assertCandidateNoFree(tx, batch.id, candidateNo);
      const created = await tx.rosterEntry.create({
        data: {
          batchId: batch.id,
          candidateNo,
          nameEn: input.nameEn,
          nameTh: input.nameTh,
          examMode: input.examMode,
          source: "MANUAL",
          school: input.school,
          level: input.level,
          rawAward: input.rawAward,
          ...derivedFields(input),
        },
      });
      await recordAudit(tx, batch, {
        entityType: "ROSTER_ENTRY",
        entityId: created.id,
        action: "ROSTER_ENTRY_CREATED",
        after: snapshot(created),
        sessionId: session.sessionId,
      });
      await enqueueRematch(tx, batch.id);
      await revalidateDraft(tx, batch.id);
      return created;
    },
    { requireRoster: true },
  );

  await afterCommit();
  return NextResponse.json({ id: entry.id });
});
