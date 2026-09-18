import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({ months: z.number().int().min(1).max(60).default(12) });

/**
 * ต่ออายุการเก็บเกียรติบัตรของรอบนี้
 *
 * มีไว้เผื่อโรงเรียนหรือผู้ปกครองขอ ซึ่งเกิดขึ้นได้จริงเวลาต้องใช้ย้อนหลัง
 * ถ้าไม่มีทางต่ออายุ ทางเลือกเดียวคือปิดระบบลบทั้งระบบ ซึ่งแย่กว่ามาก
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const months = parsed.success ? parsed.data.months : 12;

  // ต่อจากวันหมดอายุเดิม ไม่ใช่จากวันนี้ — ไม่งั้นต่ออายุตอนใกล้ครบจะได้เวลาน้อยกว่าที่ควร
  const updated = await prisma.$executeRaw`
    UPDATE certificates
    SET expires_at = expires_at + (${months} || ' months')::interval
    WHERE batch_id = ${id}::uuid AND expires_at IS NOT NULL AND files_deleted_at IS NULL`;

  return NextResponse.json({ ok: true, updated, months });
}
