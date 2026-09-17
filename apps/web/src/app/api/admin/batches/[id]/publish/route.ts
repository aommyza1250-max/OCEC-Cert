import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { applyPublish, loadPeople, needsPolicyDecision } from "@/lib/publish";
import { prisma } from "@/lib/db";

const schema = z.object({ published: z.boolean() });

/**
 * เปิด/ปิดการมองเห็นของรอบนำเข้า
 *
 * แยกขั้นตอนนี้ออกมาโดยตั้งใจ: ข้อมูลที่จับคู่เสร็จแล้วต้องให้คนตรวจก่อน
 * ถ้าจับคู่ผิดแล้วเผยแพร่ทันที ผู้ปกครองจะโหลดเกียรติบัตรของคนอื่นไปได้
 *
 * เผยแพร่ **รายคน ไม่ใช่ทั้งรอบ** — คนที่ข้อมูลครบออกไปก่อน
 * ส่วนคนที่ยังมีปัญหา (เช่นไฟล์ใบเหรียญตกหล่น) ค้างไว้ในระบบ
 * พอเติมไฟล์ที่ขาดแล้วกดเผยแพร่อีกครั้ง คนที่พร้อมแล้วจะตามออกไปเอง
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

  if (parsed.data.published) {
    const batch = await prisma.batch.findUnique({ where: { id } });
    if (!batch) return NextResponse.json({ error: "ไม่พบรอบการนำเข้านี้" }, { status: 404 });

    // รอบที่มีคนถือทั้งใบเหรียญและ Perfect Score ต้องรู้ก่อนว่าฮ่องกงส่งฉบับจริงมาแบบไหน
    // ไม่งั้นอาจเผยแพร่ใบที่ไม่มีฉบับจริงออกไปโดยไม่ตั้งใจ
    if (batch.multiAwardPolicy === "UNDECIDED" && needsPolicyDecision(await loadPeople(id))) {
      return NextResponse.json(
        { error: "กรุณาเลือกก่อนว่ารอบนี้เผยแพร่ใบเหรียญอย่างเดียว หรือทั้งใบเหรียญและ Perfect Score" },
        { status: 409 },
      );
    }
  }

  const result = await applyPublish(id, parsed.data.published);
  return NextResponse.json({ ok: true, ...result });
}
