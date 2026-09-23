import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueue, withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { loadParticipants, needsPolicyDecision, publish, withdraw } from "@/lib/publish";

const schema = z.object({ published: z.boolean() });

/**
 * เผยแพร่ หรือยกเลิกการเผยแพร่ทั้งรอบ
 *
 * แยกขั้นตอนนี้ออกมาโดยตั้งใจ: ข้อมูลที่จับคู่เสร็จแล้วต้องให้คนตรวจก่อน
 * ถ้าจับคู่ผิดแล้วเผยแพร่ทันที ผู้ปกครองจะโหลดเกียรติบัตรของคนอื่นไปได้
 *
 * เผยแพร่ **รายคน** — คนที่ข้อมูลครบและไม่มีอะไรค้างออกไป คนที่ยังมีปัญหาค้างไว้
 * ระหว่างเผยแพร่อยู่ แก้หรืออัปอะไรไม่ได้เลย ต้องยกเลิกก่อน แก้ แล้วกดเผยแพร่อีกครั้ง
 */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const { published } = await parseBody(request, schema);

  if (!published) {
    // ยกเลิกได้เสมอ รวมถึงรอบจากระบบเดิม และตอนที่มีงานค้าง (ไม่ได้แตะผลของงานนั้น)
    const result = await withBatchMutation(
      params.id,
      async (tx, batch) => {
        const outcome = await withdraw(tx, batch);
        await recordAudit(tx, batch, {
          entityType: "BATCH",
          entityId: batch.id,
          action: "PUBLICATION_WITHDRAWN",
          before: { status: batch.status },
          after: outcome,
          sessionId: session.sessionId,
        });
        return outcome;
      },
      { allowPublished: true, allowLegacy: true, allowPendingJobs: true },
    );
    return NextResponse.json({ ok: true, ...result });
  }

  const summary = await withBatchMutation(
    params.id,
    async (tx, batch) => {
      if (!batch.activeRosterImportId) throw new HttpError(409, "ยังไม่มีรายชื่อผู้เข้าสอบ จึงยังเผยแพร่ไม่ได้");
      const record = await tx.batch.findUniqueOrThrow({ where: { id: batch.id } });
      // รอบที่มีคนถือทั้งใบรางวัลหลักและใบรางวัลเสริม ต้องรู้ก่อนว่าฮ่องกงส่งฉบับจริงมาแบบไหน
      // ไม่งั้นอาจเผยแพร่ใบที่ไม่มีฉบับจริงออกไปโดยไม่ตั้งใจ
      if (record.multiAwardPolicy === "UNDECIDED" && needsPolicyDecision(await loadParticipants(tx, batch))) {
        throw new HttpError(
          409,
          "กรุณาเลือกก่อนว่ารอบนี้เผยแพร่เฉพาะใบรางวัลหลัก หรือทั้งใบรางวัลหลักและใบรางวัลเสริม",
        );
      }
      const outcome = await publish(tx, batch, record.multiAwardPolicy);
      await recordAudit(tx, batch, {
        entityType: "BATCH",
        entityId: batch.id,
        action: "PUBLISHED",
        before: { status: batch.status },
        after: outcome,
        sessionId: session.sessionId,
      });
      // เผยแพร่แล้วคือเงื่อนไขข้อสุดท้ายของการเคลียร์ไฟล์ต้นฉบับ ตั้งงานให้ worker ไปตรวจต่อ
      // ตัวงานตรวจเงื่อนไขครบทุกข้อเองอีกที ถ้ายังไม่ครบก็แค่ไม่ลบ ไม่ถือว่าล้มเหลว
      if (!record.sourcesClearedAt) {
        const pending = await tx.job.count({
          where: { batchId: batch.id, type: "CLEANUP_SOURCES", status: { in: ["QUEUED", "RUNNING"] } },
        });
        if (!pending) await enqueue(tx, batch.id, "CLEANUP_SOURCES");
      }
      return outcome;
    },
  );

  await afterCommit();
  return NextResponse.json({ ok: true, ...summary });
});
