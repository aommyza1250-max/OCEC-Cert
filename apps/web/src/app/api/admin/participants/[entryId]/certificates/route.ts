import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { afterCommit, enqueue, withBatchMutation } from "@/lib/batch-guard";
import { awardCatalog } from "@/lib/certificate-catalog";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { isSourceKeyOf } from "@/lib/r2";
import { loadEntry } from "@/lib/participants";

const schema = z.object({
  /** key ของ PDF ที่เพิ่งอัปขึ้น R2 */
  key: z.string().min(1),
  fileName: z.string().max(300).optional(),
  /** รางวัลของใบนี้ — แอดมินเลือกเองเสมอ ระบบไม่เดาจากข้อความบนหน้าหรือจาก Excel */
  awardCode: z.string().min(1, "กรุณาเลือกรางวัล"),
  purpose: z.enum(["add", "replace"]),
  /** หน้าของใบเดิมที่จะเปลี่ยนไฟล์ (เฉพาะ replace) */
  replacePageId: z.string().uuid().optional(),
});

/**
 * รับ PDF ให้ผู้เข้าสอบคนนี้ — เพิ่มใบที่ขาด หรือเปลี่ยนไฟล์ของใบเดิม
 *
 * worker ตรวจก่อนรับว่าไฟล์มีหน้าของคนนี้จริง (เลขและชื่อต้องตรง) และคัดมาเฉพาะหน้านั้น
 * ถ้าไฟล์มีหลายหน้าของคนนี้แล้วแยกไม่ออก จะปฏิเสธพร้อมบอกให้แยกเป็นไฟล์หน้าเดียว
 */
export const POST = adminHandler<{ entryId: string }>(async (request, { params, session }) => {
  const input = await parseBody(request, schema);
  const found = await prisma.rosterEntry.findUnique({ where: { id: params.entryId }, select: { batchId: true } });
  if (!found) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนนี้ในรายชื่อ");
  if (!isSourceKeyOf(found.batchId, input.key)) throw new HttpError(400, "ไม่พบไฟล์ที่อัปโหลด");

  const job = await withBatchMutation(found.batchId, async (tx, batch) => {
    const entry = await loadEntry(tx, batch, params.entryId);
    const award = awardCatalog(batch.programCode, batch.round).find((a) => a.code === input.awardCode);
    if (!award) throw new HttpError(400, `รางวัล ${input.awardCode} ไม่มีในรายการสอบ/รอบนี้`);

    const existing = await tx.certificate.findFirst({
      where: { rosterEntryId: entry.id, award: award.code },
      select: { stagingPageId: true },
    });
    if (input.purpose === "add" && existing) {
      throw new HttpError(409, `มีเกียรติบัตรรางวัล ${award.label} อยู่แล้ว — ถ้าต้องการเปลี่ยนไฟล์ ให้ใช้ปุ่มเปลี่ยนไฟล์ที่ใบนั้น`);
    }
    if (input.purpose === "replace" && existing?.stagingPageId !== input.replacePageId) {
      throw new HttpError(409, "ไม่พบใบเดิมที่จะเปลี่ยนไฟล์ — อาจถูกเปลี่ยนหรือทิ้งไปแล้ว กรุณาโหลดหน้าใหม่");
    }

    const created = await enqueue(tx, batch.id, "SPLIT", {
      kind: "single",
      purpose: input.purpose,
      pdfKey: input.key,
      fileName: input.fileName ?? null,
      rosterEntryId: entry.id,
      awardCode: award.code,
      replacePageId: input.replacePageId ?? null,
      sessionId: session.sessionId,
    });
    await recordAudit(tx, batch, {
      entityType: "ROSTER_ENTRY",
      entityId: entry.id,
      action: "CERTIFICATE_UPLOAD_REQUESTED",
      after: { purpose: input.purpose, award: award.code, fileName: input.fileName ?? null, jobId: created.id },
      sessionId: session.sessionId,
    });
    return created;
  });

  await afterCommit();
  return NextResponse.json({ jobId: job.id });
});
