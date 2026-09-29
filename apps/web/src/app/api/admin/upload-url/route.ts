import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBatchWritable } from "@/lib/batch-guard";
import { adminHandler, parseBody } from "@/lib/http";
import { keys, presignedUploadUrl } from "@/lib/r2";

const schema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["zip", "roster", "pdf"]),
});

const CONTENT_TYPES = {
  zip: "application/zip",
  roster: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

/**
 * ออกลิงก์อัปโหลดให้เบราว์เซอร์ยิงไฟล์ขึ้น R2 ตรง ๆ
 *
 * ไฟล์ ZIP เกียรติบัตรมักมีหลายร้อยหน้า ขนาดหลายร้อย MB
 * ถ้าปล่อยให้วิ่งผ่าน Next.js API เซิร์ฟเวอร์บน Railway จะกินแรมจนถูกฆ่า
 *
 * ตรวจก่อนออกลิงก์ว่ารอบนี้รับไฟล์ได้ (ไม่ได้เผยแพร่อยู่ มีรายชื่อแล้วถ้าเป็นเกียรติบัตร)
 * แอดมินจะได้ไม่ต้องรออัปไฟล์ใหญ่จนเสร็จแล้วค่อยพบว่าใช้ไม่ได้
 */
export const POST = adminHandler(async (request) => {
  const { batchId, kind } = await parseBody(request, schema);
  await assertBatchWritable(batchId, { allowPendingJobs: true, requireRoster: kind !== "roster" });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key =
    kind === "zip"
      ? keys.sourceZip(batchId, stamp)
      : kind === "roster"
        ? keys.roster(batchId, stamp)
        : keys.certificatePdfSource(batchId, stamp);
  const url = await presignedUploadUrl(key, CONTENT_TYPES[kind]);

  return NextResponse.json({ url, key, contentType: CONTENT_TYPES[kind] });
});
