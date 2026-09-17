import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({ published: z.boolean() });

/**
 * เปิด/ปิดการมองเห็นของทั้ง batch
 *
 * แยกขั้นตอนนี้ออกมาโดยตั้งใจ: ข้อมูลที่จับคู่เสร็จแล้วต้องให้คนตรวจก่อน
 * ถ้าจับคู่ผิดแล้วเผยแพร่ทันที ผู้ปกครองจะโหลดเกียรติบัตรของคนอื่นไปได้
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

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.certificate.updateMany({
      where: { batchId: id },
      data: { published: parsed.data.published ? new Date() : null },
    });
    await tx.batch.update({
      where: { id },
      data: { status: parsed.data.published ? "PUBLISHED" : "READY" },
    });
    return updated.count;
  });

  return NextResponse.json({ ok: true, affected: result });
}
