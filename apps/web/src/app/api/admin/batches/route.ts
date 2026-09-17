import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  programId: z.string().uuid("กรุณาเลือกรายการสอบ"),
  academicYear: z.coerce.number().int().min(2500).max(2700),
  note: z.string().optional(),
});

/** สร้างรอบการนำเข้าใหม่ พร้อมสร้าง "รายการสอบ x ปีการศึกษา" ให้ถ้ายังไม่มี */
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }
  const { programId, academicYear, note } = parsed.data;

  const program = await prisma.examProgram.findUnique({ where: { id: programId } });
  if (!program) {
    return NextResponse.json({ error: "ไม่พบรายการสอบที่เลือก" }, { status: 404 });
  }

  const exam = await prisma.exam.upsert({
    where: { programId_academicYear: { programId, academicYear } },
    update: {},
    create: { programId, academicYear },
  });

  const batch = await prisma.batch.create({ data: { examId: exam.id, note: note || null } });

  return NextResponse.json({ id: batch.id });
}
