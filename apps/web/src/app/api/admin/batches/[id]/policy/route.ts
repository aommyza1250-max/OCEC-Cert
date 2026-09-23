import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, parseBody } from "@/lib/http";

const schema = z.object({ policy: z.enum(["ALL", "MEDAL_ONLY"]) });

/**
 * บันทึกว่าฮ่องกงส่งเกียรติบัตรฉบับจริงแบบไหนสำหรับรอบนี้
 *
 * เปลี่ยนได้เฉพาะตอนยังไม่เผยแพร่ — เป็นการเปลี่ยนสิ่งที่ผู้ปกครองเห็น
 * จึงต้องผ่านขั้นยกเลิก -> เปลี่ยน -> เผยแพร่ใหม่ เหมือนการแก้ไขอื่น ๆ
 */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const { policy } = await parseBody(request, schema);
  await withBatchMutation(params.id, async (tx, batch) => {
    const before = await tx.batch.findUniqueOrThrow({ where: { id: batch.id }, select: { multiAwardPolicy: true } });
    await tx.batch.update({ where: { id: batch.id }, data: { multiAwardPolicy: policy } });
    await recordAudit(tx, batch, {
      entityType: "BATCH",
      entityId: batch.id,
      action: "POLICY_CHANGED",
      before: { policy: before.multiAwardPolicy },
      after: { policy },
      sessionId: session.sessionId,
    });
  });
  return NextResponse.json({ ok: true });
});
