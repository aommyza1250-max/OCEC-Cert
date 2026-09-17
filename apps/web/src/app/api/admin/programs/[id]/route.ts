import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  kind: z.enum(["DOMESTIC", "INTERNATIONAL"]).optional(),
  active: z.boolean().optional(),
});

/**
 * แก้ไขรายการสอบ
 *
 * ตั้งใจไม่ให้แก้ `code` หลังสร้างแล้ว เพราะ code ถูกฝังอยู่ในชื่อไฟล์ที่ตัดไปแล้วบน R2
 * แก้ code จะทำให้ชื่อไฟล์เก่ากับใหม่ไม่ตรงกัน ถ้าต้องเปลี่ยนจริงให้สร้างรายการใหม่แทน
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const program = await prisma.examProgram.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ program });
}

/**
 * ลบรายการสอบ — ลบได้เฉพาะรายการที่ยังไม่เคยใช้
 *
 * ถ้าเคยมีรอบการนำเข้าแล้ว การลบจะทำให้เกียรติบัตรเก่ากำพร้า
 * กรณีนั้นให้ปิดการใช้งาน (active = false) แทน ซึ่งจะไม่โผล่ใน dropdown อีก
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await params;
  const used = await prisma.exam.count({ where: { programId: id } });
  if (used > 0) {
    return NextResponse.json(
      {
        error: `รายการสอบนี้ถูกใช้ไปแล้ว ${used} ปีการศึกษา จึงลบไม่ได้ — ใช้วิธีปิดการใช้งานแทน`,
      },
      { status: 409 },
    );
  }

  await prisma.examProgram.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
