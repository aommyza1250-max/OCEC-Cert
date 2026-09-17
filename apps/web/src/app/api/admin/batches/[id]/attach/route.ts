import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { keys } from "@/lib/r2";
import { wakeWorker } from "@/lib/worker";

const schema = z.object({
  kind: z.enum(["zip", "excel"]),
  /** key ที่เพิ่งอัปโหลดไป — ฝั่ง client ได้มาจาก /api/admin/upload-url */
  key: z.string().optional(),
  /**
   * append = เติมไฟล์ที่ตกหล่นเข้ารอบเดิม หน้าที่มีอยู่แล้วไม่ถูกแตะ
   * replace = ตัดใหม่ทั้งรอบ ลบผลเดิมทิ้งทั้งหมด
   */
  mode: z.enum(["append", "replace"]).default("replace"),
});

/**
 * บอกระบบว่าไฟล์อัปโหลดขึ้น R2 เสร็จแล้ว ให้ตั้งงานให้ worker ไปทำต่อ
 *
 * แยกจากขั้นขอลิงก์อัปโหลด เพราะการอัปโหลดเกิดที่เบราว์เซอร์กับ R2 โดยตรง
 * เซิร์ฟเวอร์ไม่มีทางรู้เองว่าอัปโหลดเสร็จเมื่อไหร่
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { kind, mode } = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "ไม่พบรอบการนำเข้านี้" }, { status: 404 });

  if (kind === "excel" && !batch.sourceZipKey) {
    return NextResponse.json(
      { error: "ต้องอัปโหลดไฟล์ ZIP เกียรติบัตรและรอตัดแยกให้เสร็จก่อน จึงจะนำเข้ารายชื่อได้" },
      { status: 409 },
    );
  }

  // ยอมรับเฉพาะ key ที่อยู่ใต้โฟลเดอร์ของรอบนำเข้านี้ กันไม่ให้ชี้ไปไฟล์ของรอบอื่น
  const prefix = `sources/${id}/`;
  const uploadedKey =
    parsed.data.key && parsed.data.key.startsWith(prefix)
      ? parsed.data.key
      : kind === "zip"
        ? null
        : keys.sourceExcel(id);

  if (kind === "zip" && !uploadedKey) {
    return NextResponse.json({ error: "ไม่พบไฟล์ที่อัปโหลด" }, { status: 400 });
  }

  const job = await prisma.$transaction(async (tx) => {
    await tx.batch.update({
      where: { id },
      data:
        kind === "zip"
          ? { sourceZipKey: uploadedKey, status: "SPLITTING" }
          : { sourceExcelKey: uploadedKey, status: "MATCHING" },
    });
    return tx.job.create({
      data: {
        batchId: id,
        type: kind === "zip" ? "SPLIT" : "MATCH",
        payload: kind === "zip" ? { zipKey: uploadedKey, mode } : {},
      },
    });
  });

  // ปลุก worker ให้เริ่มทันที ถ้าปลุกไม่ติดก็ไม่เป็นไร รอบ poll ถัดไปก็หยิบเอง
  const woke = await wakeWorker();

  return NextResponse.json({ jobId: job.id, workerNotified: woke });
}
