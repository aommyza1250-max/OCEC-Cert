import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  // รหัสนี้คือสิ่งที่ไปต่อท้ายชื่อไฟล์ {FNAME}_{LNAME}_{CODE}.pdf
  // จำกัดให้เป็น A-Z 0-9 และ _ เท่านั้น เพราะต้องใช้เป็นชื่อไฟล์และ object key บน R2
  code: z
    .string()
    .trim()
    .min(2, "รหัสต้องยาวอย่างน้อย 2 ตัวอักษร")
    .max(20, "รหัสยาวเกินไป")
    .regex(/^[A-Za-z0-9_]+$/, "รหัสใช้ได้เฉพาะ A-Z 0-9 และ _ (ห้ามเว้นวรรคหรือภาษาไทย)")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "กรุณาระบุชื่อเต็มของรายการสอบ"),
  kind: z.enum(["DOMESTIC", "INTERNATIONAL"]),
});

export async function GET() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const programs = await prisma.examProgram.findMany({
    orderBy: [{ active: "desc" }, { code: "asc" }],
    include: { _count: { select: { exams: true } } },
  });
  return NextResponse.json({ programs });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const existing = await prisma.examProgram.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return NextResponse.json(
      { error: `มีรายการสอบรหัส ${parsed.data.code} อยู่แล้ว` },
      { status: 409 },
    );
  }

  const program = await prisma.examProgram.create({ data: parsed.data });
  return NextResponse.json({ program });
}
