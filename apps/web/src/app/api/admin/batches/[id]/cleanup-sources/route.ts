import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { wakeWorker } from "@/lib/worker";

/**
 * สั่งเคลียร์ไฟล์ต้นฉบับ (ZIP) ของรอบนี้เดี๋ยวนี้
 *
 * ปกติระบบตั้งงานนี้ให้เองหลังเผยแพร่ ปุ่มนี้มีไว้เผื่อแอดมินอยากเคลียร์เองก่อน
 * หรือหลังแก้เงื่อนไขที่ติดอยู่เสร็จแล้วไม่อยากรอรอบถัดไป
 *
 * เงื่อนไขทั้ง 4 ข้อยังถูกตรวจที่ worker เหมือนเดิม ปุ่มนี้ไม่ได้ข้ามการตรวจ
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "ไม่พบรอบการนำเข้านี้" }, { status: 404 });
  if (batch.sourcesClearedAt) {
    return NextResponse.json({ error: "เคลียร์ไปแล้ว" }, { status: 409 });
  }

  const job = await prisma.job.create({ data: { batchId: id, type: "CLEANUP_SOURCES" } });
  const woke = await wakeWorker();
  return NextResponse.json({ jobId: job.id, workerNotified: woke });
}
