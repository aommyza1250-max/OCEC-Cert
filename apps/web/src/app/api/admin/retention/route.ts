import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { wakeWorker } from "@/lib/worker";

/**
 * สั่งให้ระบบ "ลองดูว่าจะลบอะไรบ้าง" โดยไม่ลบจริง
 *
 * ตัวลบจริงทำงานเองวันละครั้ง ปุ่มนี้มีไว้ให้แอดมินเห็นรายการล่วงหน้าเมื่อไหร่ก็ได้
 * ก่อนตัดสินใจเปิดสวิตช์ RETENTION_ENABLED
 */
export async function POST() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const job = await prisma.job.create({ data: { type: "EXPIRE", payload: { dryRun: true } } });
  const woke = await wakeWorker();
  return NextResponse.json({ jobId: job.id, workerNotified: woke });
}
