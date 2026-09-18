import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { batchConfirmPhrase } from "@/lib/batch-delete";
import { wakeWorker } from "@/lib/worker";

const schema = z.object({
  /** ต้องพิมพ์ชื่อรอบให้ตรงเป๊ะ เช่น "HKIMO FINAL 2026" */
  confirm: z.string().min(1),
  note: z.string().max(500).optional(),
});

/**
 * ลบรอบการนำเข้าทั้งรอบ — ไฟล์บน R2 และแถวในฐานข้อมูล
 *
 * เป็นการกระทำที่ย้อนกลับไม่ได้และกระทบผู้ปกครองทันทีถ้ารอบนั้นเผยแพร่อยู่
 * จึงบังคับให้พิมพ์ชื่อรอบยืนยัน ไม่ใช่แค่กดปุ่ม "ตกลง" ในกล่องเตือน
 * (กล่องเตือนแบบกดผ่านได้ในหนึ่งวินาที ไม่ได้ช่วยอะไรกับงานที่ลบของจริง)
 *
 * งานจริงทำที่ worker เพราะต้องลบไฟล์หลายร้อยชิ้น
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

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { exam: { include: { program: true } } },
  });
  if (!batch) return NextResponse.json({ error: "ไม่พบรอบการนำเข้านี้" }, { status: 404 });

  if (batch.status === "DELETING") {
    return NextResponse.json({ error: "รอบนี้กำลังถูกลบอยู่แล้ว" }, { status: 409 });
  }

  const phrase = batchConfirmPhrase(batch.exam.program.code, batch.exam.round, batch.exam.year);
  if (parsed.data.confirm.trim().toUpperCase() !== phrase) {
    return NextResponse.json(
      { error: `ข้อความยืนยันไม่ตรง ต้องพิมพ์ว่า "${phrase}"` },
      { status: 400 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    await tx.batch.update({ where: { id }, data: { status: "DELETING" } });
    return tx.job.create({
      data: { batchId: id, type: "DELETE_BATCH", payload: { note: parsed.data.note ?? null } },
    });
  });

  const woke = await wakeWorker();
  return NextResponse.json({ jobId: job.id, workerNotified: woke });
}
