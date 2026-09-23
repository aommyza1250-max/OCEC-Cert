import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, HttpError, parseBody } from "@/lib/http";

const schema = z.object({ importId: z.string().uuid() });

/** ทิ้งร่างรายชื่อที่ยังไม่ได้ใช้ — รายชื่อที่ใช้อยู่ไม่ถูกแตะ ไฟล์ต้นฉบับยังเก็บไว้ตรวจย้อนหลัง */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const { importId } = await parseBody(request, schema);

  await withBatchMutation(
    params.id,
    async (tx, batch) => {
      const draft = await tx.rosterImport.findFirst({ where: { id: importId, batchId: batch.id } });
      if (!draft || !["PENDING", "READY", "INVALID"].includes(draft.status)) {
        throw new HttpError(409, "ร่างนี้ทิ้งไม่ได้ (อาจถูกใช้หรือทิ้งไปแล้ว)");
      }
      await tx.rosterImport.update({ where: { id: draft.id }, data: { status: "DISCARDED" } });
      await recordAudit(tx, batch, {
        entityType: "ROSTER_IMPORT",
        entityId: draft.id,
        action: "ROSTER_DRAFT_DISCARDED",
        before: { status: draft.status, fileName: draft.fileName },
        sessionId: session.sessionId,
      });
    },
    { allowPendingJobs: true },
  );

  return NextResponse.json({ ok: true });
});
