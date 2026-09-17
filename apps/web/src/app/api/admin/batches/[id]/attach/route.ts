import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { keys } from "@/lib/r2";
import { wakeWorker } from "@/lib/worker";

const schema = z.object({ kind: z.enum(["pdf", "excel"]) });

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
  const { kind } = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "ไม่พบรอบการนำเข้านี้" }, { status: 404 });

  if (kind === "excel" && !batch.sourcePdfKey) {
    return NextResponse.json(
      { error: "ต้องอัปโหลดไฟล์ PDF และรอตัดแยกให้เสร็จก่อน จึงจะนำเข้ารายชื่อได้" },
      { status: 409 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    await tx.batch.update({
      where: { id },
      data:
        kind === "pdf"
          ? { sourcePdfKey: keys.sourcePdf(id), status: "SPLITTING" }
          : { sourceExcelKey: keys.sourceExcel(id), status: "MATCHING" },
    });
    return tx.job.create({
      data: { batchId: id, type: kind === "pdf" ? "SPLIT" : "MATCH" },
    });
  });

  // ปลุก worker ให้เริ่มทันที ถ้าปลุกไม่ติดก็ไม่เป็นไร รอบ poll ถัดไปก็หยิบเอง
  const woke = await wakeWorker();

  return NextResponse.json({ jobId: job.id, workerNotified: woke });
}
