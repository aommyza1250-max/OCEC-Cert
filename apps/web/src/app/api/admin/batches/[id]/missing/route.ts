import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadMissingItems } from "@/lib/missing";
import { wakeWorker } from "@/lib/worker";

const schema = z.object({
  /** key ของไฟล์ PDF ที่เพิ่งอัปโหลดขึ้น R2 */
  key: z.string(),
  /** เลขผู้เข้าสอบของคนที่ไฟล์นี้ควรเป็นของเขา */
  certNo: z.string().min(1),
});

/**
 * รับไฟล์ PDF ของคนที่ตกหล่น ทีละใบ
 *
 * รางวัลที่คาดไว้ถูกคำนวณจากฝั่งเซิร์ฟเวอร์ ไม่รับจากผู้ใช้ เพื่อให้ตรงกับที่แสดงบนหน้าจอเสมอ
 * ส่วนการตรวจว่าไฟล์เป็นของคนนี้จริง worker จะทำก่อนลงมือประมวลผลอะไรทั้งนั้น
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

  // ยอมรับเฉพาะไฟล์ที่อยู่ใต้โฟลเดอร์ของรอบนำเข้านี้
  if (!parsed.data.key.startsWith(`sources/${id}/`)) {
    return NextResponse.json({ error: "ไม่พบไฟล์ที่อัปโหลด" }, { status: 400 });
  }

  const item = (await loadMissingItems(id)).find((m) => m.certNo === parsed.data.certNo);
  if (!item) {
    return NextResponse.json(
      { error: "ไม่พบรายการที่ต้องตามเก็บของเลขผู้เข้าสอบนี้ — อาจมีคนเติมไปแล้ว" },
      { status: 404 },
    );
  }

  const job = await prisma.job.create({
    data: {
      batchId: id,
      type: "SPLIT",
      payload: {
        mode: "append",
        pdfKey: parsed.data.key,
        expectCertNo: item.certNo,
        expectedAward: item.expectedAward,
      },
    },
  });

  const woke = await wakeWorker();
  return NextResponse.json({ jobId: job.id, workerNotified: woke });
}
