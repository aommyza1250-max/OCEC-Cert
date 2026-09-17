import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyPublish } from "@/lib/publish";

const schema = z.object({ policy: z.enum(["ALL", "MEDAL_ONLY"]) });

/**
 * บันทึกว่าฮ่องกงส่งเกียรติบัตรฉบับจริงแบบไหนสำหรับรอบนี้
 *
 * ถ้ารอบนี้เผยแพร่ไปแล้ว จะลงมือปรับให้ทันที เพราะการเปลี่ยนตัวเลือกคือการตั้งใจ
 * เปลี่ยนสิ่งที่ผู้ปกครองเห็น ไม่ควรต้องไปกดปุ่มเผยแพร่ซ้ำอีกทีให้ลืม
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

  const batch = await prisma.batch.update({
    where: { id },
    data: { multiAwardPolicy: parsed.data.policy },
  });

  const applied = batch.status === "PUBLISHED" ? await applyPublish(id, true) : null;
  return NextResponse.json({ ok: true, applied });
}
