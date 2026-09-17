import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * อ่านสถานะของงานที่สั่งไป ให้หน้าจอตามผลได้
 *
 * งานทั้งหมดทำเบื้องหลัง ถ้าไม่มีทางถามสถานะ แอดมินจะกดแล้วไม่รู้ว่าเกิดอะไรขึ้น
 * แยกไม่ออกระหว่าง "ระบบไม่ทำงาน" กับ "ไฟล์ไม่ถูก" ซึ่งเป็นสองเรื่องที่ทำต่อคนละแบบ
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: { status: true, error: true, progress: true },
  });
  if (!job) return NextResponse.json({ error: "ไม่พบงานนี้" }, { status: 404 });

  return NextResponse.json({
    status: job.status,
    // ข้อความบรรทัดแรกคือคำอธิบายสำหรับคน ที่เหลือเป็น traceback สำหรับคนแก้โค้ด
    error: job.error?.split("\n")[0] ?? null,
    progress: job.progress,
  });
}
