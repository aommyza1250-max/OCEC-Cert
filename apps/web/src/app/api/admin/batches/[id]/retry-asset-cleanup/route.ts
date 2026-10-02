import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueueRematch, withBatchMutation } from "@/lib/batch-guard";
import { HttpError, adminHandler } from "@/lib/http";

/** ลองลบไฟล์ที่คิวไว้ซ้ำผ่าน worker; ledger คงอยู่จน R2 ตอบว่าลบสำเร็จ */
export const POST = adminHandler<{ id: string }>(async (_request, { params, session }) => {
  const jobId = await withBatchMutation(params.id, async (tx, batch) => {
    const pending = await tx.assetCleanup.count({ where: { batchId: batch.id, completedAt: null } });
    if (pending === 0) throw new HttpError(409, "ไม่มีไฟล์รอลบแล้ว");
    const job = await enqueueRematch(tx, batch.id);
    await recordAudit(tx, batch, {
      entityType: "BATCH", action: "ASSET_CLEANUP_RETRY_REQUESTED",
      after: { pending, jobId: job.id }, sessionId: session.sessionId,
    });
    return job.id;
  });
  await afterCommit();
  return NextResponse.json({ jobId });
});
