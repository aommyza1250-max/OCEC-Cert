import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueue, withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, HttpError, parseBody } from "@/lib/http";

const choice = z.enum(["MANUAL", "INCOMING"]);
const schema = z.object({
  importId: z.string().uuid(),
  /** คำตัดสินของรายการที่ชนกับผู้เข้าสอบที่เพิ่มเอง — ต้องครบทุกรายการ */
  resolutions: z
    .array(
      z.object({
        conflictId: z.string(),
        action: z.enum(["MERGE", "KEEP_MANUAL"]),
        fields: z
          .object({
            candidateNo: choice.optional(),
            name: choice.optional(),
            examMode: choice.optional(),
            school: choice.optional(),
            level: choice.optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

/**
 * ใช้รายชื่อชุดที่ตรวจผ่านแล้ว — ตัวสลับจริงทำที่ worker ในทรานแซกชันเดียว แล้วจับคู่ใหม่ทั้งรอบ
 *
 * ตรวจที่นี่ก่อนตั้งงาน: ต้องเป็นร่างล่าสุดที่ตรวจผ่าน และตัดสินรายการที่ชนครบแล้ว
 * worker ตรวจซ้ำอีกรอบ เพราะระหว่างรอคิวอาจมีคนแก้รายการที่เพิ่มเองไปแล้ว
 */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const { importId, resolutions } = await parseBody(request, schema);

  const result = await withBatchMutation(params.id, async (tx, batch) => {
    const draft = await tx.rosterImport.findFirst({ where: { id: importId, batchId: batch.id } });
    if (!draft || draft.status !== "READY") {
      throw new HttpError(409, "รายชื่อชุดนี้ใช้ไม่ได้ (ยังตรวจไม่เสร็จ ตรวจไม่ผ่าน หรือมีชุดใหม่กว่า)");
    }
    const conflicts = (draft.conflicts as { id: string }[]) ?? [];
    const decided = new Set(resolutions.map((r) => r.conflictId));
    const missing = conflicts.filter((c) => !decided.has(c.id));
    if (missing.length > 0) {
      throw new HttpError(409, `ยังมีรายการที่ชนกับผู้เข้าสอบที่เพิ่มเองที่ยังไม่ได้ตัดสิน ${missing.length} รายการ`);
    }

    await tx.rosterImport.update({ where: { id: draft.id }, data: { status: "ACTIVATING" } });
    const job = await enqueue(tx, batch.id, "ROSTER_ACTIVATE", {
      importId: draft.id,
      resolutions,
      sessionId: session.sessionId,
    });
    await recordAudit(tx, batch, {
      entityType: "ROSTER_IMPORT",
      entityId: draft.id,
      action: "ROSTER_ACTIVATION_REQUESTED",
      after: { total: draft.totalCount, online: draft.onlineCount, onsite: draft.onsiteCount, resolutions },
      sessionId: session.sessionId,
    });
    return { jobId: job.id };
  });

  await afterCommit();
  return NextResponse.json(result);
});
