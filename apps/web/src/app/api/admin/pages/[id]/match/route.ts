import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nameSortKey, normalizeName, normalizeSchool } from "@/lib/normalize";

const schema = z
  .object({
    nameTh: z.string().trim().optional(),
    nameEn: z.string().trim().optional(),
    school: z.string().trim().optional(),
    award: z.string().trim().optional(),
  })
  .refine((v) => (v.nameTh?.length ?? 0) > 0 || (v.nameEn?.length ?? 0) > 0, {
    message: "ต้องกรอกชื่ออย่างน้อยหนึ่งภาษา",
  });

/**
 * จับคู่หน้าที่ระบบทำให้ไม่ได้ ด้วยมือของแอดมิน
 *
 * ใช้ตรรกะเดียวกับฝั่ง worker คือหาผู้เข้าสอบเดิมจากชื่อที่ normalize แล้ว
 * ถ้าไม่มีจึงสร้างใหม่ เพื่อให้เกียรติบัตรของคนเดียวกันรวมอยู่ด้วยกันเสมอ
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const page = await prisma.stagingPage.findUnique({
    where: { id },
    include: { batch: true },
  });
  if (!page) return NextResponse.json({ error: "ไม่พบหน้านี้" }, { status: 404 });
  if (!page.pdfKey) {
    return NextResponse.json({ error: "หน้านี้ไม่มีไฟล์ PDF ที่ตัดไว้" }, { status: 409 });
  }

  const nameTh = parsed.data.nameTh || null;
  const nameEn = parsed.data.nameEn || null;
  const school = parsed.data.school || null;
  const nameThNormalized = normalizeName(nameTh) || null;
  const nameEnNormalized = normalizeName(nameEn) || null;
  const schoolNormalized = normalizeSchool(school) || null;

  // ใช้ตรรกะเดียวกับ worker: ชื่อตรงกันก่อน แล้วแคบด้วยโรงเรียนถ้ามี
  // ถ้าระบุโรงเรียนมาแต่ไม่มีใครชื่อนี้ที่โรงเรียนนั้น = คนใหม่
  const sameName = await prisma.student.findMany({
    where: {
      OR: [
        ...(nameEnNormalized ? [{ nameEnNormalized }] : []),
        ...(nameThNormalized ? [{ nameThNormalized }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const narrowed = schoolNormalized
    ? (sameName.filter((s) => s.schoolNormalized === schoolNormalized).length > 0
        ? sameName.filter((s) => s.schoolNormalized === schoolNormalized)
        : sameName.filter((s) => !s.schoolNormalized))
    : sameName;

  const student =
    narrowed[0] ??
    (await prisma.student.create({
      data: {
        nameTh,
        nameEn,
        school,
        nameThNormalized,
        nameEnNormalized,
        schoolNormalized,
        nameEnSortKey: nameSortKey(nameEn) || null,
      },
    }));

  await prisma.$transaction([
    prisma.stagingPage.update({
      where: { id },
      data: {
        matchStatus: "MATCHED",
        matchedStudentId: student.id,
        matchedManually: true,
        matchNote: null,
      },
    }),
    prisma.certificate.upsert({
      where: { examId_studentId: { examId: page.batch.examId, studentId: student.id } },
      update: {
        stagingPageId: page.id,
        batchId: page.batchId,
        pdfKey: page.pdfKey,
        previewKey: page.previewKey,
        pageNumber: page.pageNumber,
        award: parsed.data.award || null,
        certNo: page.certNo,
        level: page.level,
      },
      create: {
        studentId: student.id,
        examId: page.batch.examId,
        batchId: page.batchId,
        stagingPageId: page.id,
        pdfKey: page.pdfKey,
        previewKey: page.previewKey,
        pageNumber: page.pageNumber,
        award: parsed.data.award || null,
        certNo: page.certNo,
        level: page.level,
        // เผยแพร่ตามสถานะของ batch ไม่ใช่เผยแพร่ทันที
        published: page.batch.status === "PUBLISHED" ? new Date() : null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, studentId: student.id });
}
