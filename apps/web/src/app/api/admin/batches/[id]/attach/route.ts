import { NextResponse } from "next/server";
import { z } from "zod";
import { afterCommit, enqueue, withBatchMutation } from "@/lib/batch-guard";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { isSourceKeyOf } from "@/lib/r2";

const schema = z.object({
  kind: z.enum(["zip", "roster"]),
  /** key ที่เพิ่งอัปโหลดไป — ฝั่ง client ได้มาจาก /api/admin/upload-url */
  key: z.string().min(1),
  /** ชื่อไฟล์บนเครื่องแอดมิน — แสดงในประวัติการอัป ให้รู้ว่าผลแต่ละก้อนมาจากไฟล์ไหน */
  fileName: z.string().max(300).optional(),
});

/**
 * บอกระบบว่าไฟล์อัปโหลดขึ้น R2 เสร็จแล้ว ให้ตั้งงานให้ worker ไปทำต่อ
 *
 * แยกจากขั้นขอลิงก์อัปโหลด เพราะการอัปโหลดเกิดที่เบราว์เซอร์กับ R2 โดยตรง
 * เซิร์ฟเวอร์ไม่มีทางรู้เองว่าอัปโหลดเสร็จเมื่อไหร่
 *
 *   roster — เก็บเป็นร่าง แล้วให้ worker ตรวจ ยังไม่แตะรายชื่อที่ใช้อยู่ (แอดมินต้องกดใช้เอง)
 *   zip    — ต้องมีรายชื่อที่ใช้อยู่ก่อน อัปกี่ครั้งก็ได้ แต่ละครั้งเติมเฉพาะที่ยังไม่มี
 */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const { kind, key, fileName } = await parseBody(request, schema);
  if (!isSourceKeyOf(params.id, key)) throw new HttpError(400, "ไม่พบไฟล์ที่อัปโหลด");

  const result = await withBatchMutation(
    params.id,
    async (tx, batch) => {
      if (kind === "roster") {
        // ร่างที่ค้างอยู่ถูกแทนด้วยไฟล์ใหม่ — กดใช้ได้เฉพาะร่างล่าสุดเสมอ ไม่มีทางเผลอใช้ร่างเก่า
        await tx.rosterImport.updateMany({
          where: { batchId: batch.id, status: { in: ["PENDING", "READY", "INVALID"] } },
          data: { status: "DISCARDED" },
        });
        const draft = await tx.rosterImport.create({
          data: { batchId: batch.id, sourceKey: key, fileName: fileName ?? null },
        });
        const job = await enqueue(tx, batch.id, "ROSTER_VALIDATE", { importId: draft.id });
        return { jobId: job.id, importId: draft.id };
      }

      if (!batch.activeRosterImportId) {
        throw new HttpError(409, "ต้องใช้รายชื่อผู้เข้าสอบก่อน จึงจะอัปโหลดเกียรติบัตรได้");
      }
      await tx.batch.update({ where: { id: batch.id }, data: { sourceZipKey: key } });
      const job = await enqueue(tx, batch.id, "SPLIT", {
        kind: "zip",
        zipKey: key,
        fileName: fileName ?? null,
        sessionId: session.sessionId,
      });
      return { jobId: job.id };
    },
    { allowPendingJobs: true },
  );

  await afterCommit();
  return NextResponse.json(result);
});
