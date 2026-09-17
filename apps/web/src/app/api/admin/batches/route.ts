import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  programId: z.string().uuid("กรุณาเลือกรายการสอบ"),
  round: z.enum(["HEAT", "FINAL"], { message: "กรุณาเลือกรอบการสอบ" }),
  // ปี ค.ศ. ตามที่พิมพ์อยู่บนหน้าเกียรติบัตร ไม่ใช่ พ.ศ.
  year: z.coerce.number().int().min(2000).max(2100),
  note: z.string().optional(),
});

/** สร้างรอบการนำเข้าใหม่ พร้อมสร้าง "รายการสอบ x รอบ x ปี" ให้ถ้ายังไม่มี */
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
  const { programId, round, year, note } = parsed.data;

  const program = await prisma.examProgram.findUnique({ where: { id: programId } });
  if (!program) {
    return NextResponse.json({ error: "ไม่พบรายการสอบที่เลือก" }, { status: 404 });
  }

  const exam = await prisma.exam.upsert({
    where: { programId_round_year: { programId, round, year } },
    update: {},
    create: { programId, round, year },
    include: { batches: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  // รายการสอบมีไม่กี่รายการ และแต่ละรายการแยกเป็นรอบกับปีอยู่แล้ว
  // การสร้างซ้ำจึงแปลว่าแอดมินลืมหรือกดพลาด ไม่ใช่ความตั้งใจ
  // ถ้าปล่อยให้สร้างได้ จะมีหน้ารอบนำเข้าสองหน้าของการสอบเดียวกัน
  // งานกระจายคนละที่ และเกียรติบัตรจะถูกย้ายไปมาจนหน้าเดิมดูเหมือนว่างเปล่า
  const existing = exam.batches[0];
  if (existing) {
    return NextResponse.json(
      {
        error: `${program.code} รอบ ${round === "HEAT" ? "Heat" : "Final"} ปี ${year} มีรอบการนำเข้าอยู่แล้ว`,
        hint: "ถ้าต้องการเพิ่มไฟล์ที่ตกหล่นหรือแก้ไข ให้ทำที่รอบเดิม",
        existingBatchId: existing.id,
      },
      { status: 409 },
    );
  }

  const batch = await prisma.batch.create({ data: { examId: exam.id, note: note || null } });

  return NextResponse.json({ id: batch.id });
}
