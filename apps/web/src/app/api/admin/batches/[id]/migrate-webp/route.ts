import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueue, withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, HttpError, parseBody } from "@/lib/http";

const schema = z.object({ dryRun: z.boolean().default(true) });

/** Temporary migration control. The worker checks each asset before switching references. */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const { dryRun } = await parseBody(request, schema);
  const job = await withBatchMutation(
    params.id,
    async (tx, batch) => {
      const pending = await tx.job.count({
        where: { batchId: batch.id, status: { in: ["QUEUED", "RUNNING"] } },
      });
      if (pending) throw new HttpError(409, "รอบนี้มีงานที่กำลังประมวลผลอยู่");
      const queued = await enqueue(tx, batch.id, "MIGRATE_WEBP", { dryRun });
      await recordAudit(tx, batch, {
        entityType: "BATCH",
        entityId: batch.id,
        action: dryRun ? "WEBP_MIGRATION_CHECK_QUEUED" : "WEBP_MIGRATION_QUEUED",
        before: null,
        after: { jobId: queued.id },
        sessionId: session.sessionId,
      });
      return queued;
    },
    { allowPublished: true, allowLegacy: true },
  );
  await afterCommit();
  return NextResponse.json({ jobId: job.id });
});
