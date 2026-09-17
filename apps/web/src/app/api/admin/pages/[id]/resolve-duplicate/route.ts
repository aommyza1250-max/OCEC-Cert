import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nameSortKey, normalizeName, normalizeSchool } from "@/lib/normalize";

const schema = z.object({
  action: z.enum(["separate", "keep", "discard"]),
  // ใช้เฉพาะตอน separate — เผื่อแอดมินอยากเติมชื่อไทยให้คนที่แยกออกมา
  nameTh: z.string().trim().optional(),
  nameEn: z.string().trim().optional(),
  school: z.string().trim().optional(),
});

/**
 * ตัดสินหน้าที่ชื่อซ้ำกับคนที่จับคู่ไปแล้วในรายการสอบเดียวกัน
 *
 * ระบบตั้งใจไม่เดาให้ เพราะชื่อซ้ำเป็นได้สองอย่างที่ผลลัพธ์ต่างกันมาก:
 *   separate — คนละคนที่บังเอิญชื่อเหมือนกัน  -> แยกเป็นผู้เข้าสอบใหม่ ได้เกียรติบัตรทั้งคู่
 *   keep     — เป็นใบซ้ำ และใบนี้คือใบที่ถูก   -> ใช้ใบนี้แทนใบเดิม ใบเดิมถูกทิ้ง
 *   discard  — เป็นใบซ้ำ และใบเดิมถูกอยู่แล้ว  -> ทิ้งใบนี้
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

  const page = await prisma.stagingPage.findUnique({
    where: { id },
    include: { batch: { include: { exam: true } } },
  });
  if (!page) return NextResponse.json({ error: "ไม่พบหน้านี้" }, { status: 404 });
  if (page.matchStatus !== "DUPLICATE_NAME") {
    return NextResponse.json(
      { error: "หน้านี้ไม่ได้อยู่ในสถานะรอตัดสินชื่อซ้ำ" },
      { status: 409 },
    );
  }
  if (!page.pdfKey || !page.award) {
    return NextResponse.json(
      { error: "หน้านี้ไม่มีไฟล์ PDF หรือรางวัลที่ตัดไว้" },
      { status: 409 },
    );
  }

  const examId = page.batch.examId;

  if (parsed.data.action === "discard") {
    await prisma.stagingPage.update({
      where: { id },
      data: {
        matchStatus: "DISCARDED",
        matchedManually: true,
        matchNote: "แอดมินตัดสินว่าเป็นใบซ้ำ จึงไม่นำเข้า",
      },
    });
    return NextResponse.json({ ok: true });
  }

  // อีกสองทางต้องรู้ว่าใบเดิมที่ชนกันคือใบไหน
  const rival = await prisma.stagingPage.findFirst({
    where: {
      batchId: page.batchId,
      matchStatus: "MATCHED",
      extractedNameNormalized: page.extractedNameNormalized,
      id: { not: page.id },
    },
    orderBy: { pageNumber: "asc" },
  });

  if (parsed.data.action === "keep") {
    if (!rival?.matchedStudentId) {
      return NextResponse.json({ error: "ไม่พบใบเดิมที่ชนกัน" }, { status: 409 });
    }
    await prisma.$transaction([
      // ใบเดิมถูกแทนที่
      prisma.stagingPage.update({
        where: { id: rival.id },
        data: {
          matchStatus: "DISCARDED",
          matchedStudentId: null,
          matchedManually: true,
          matchNote: `แอดมินเลือกใช้หน้า ${page.pageNumber} แทนหน้านี้`,
        },
      }),
      prisma.stagingPage.update({
        where: { id: page.id },
        data: {
          matchStatus: "MATCHED",
          matchedStudentId: rival.matchedStudentId,
          matchedManually: true,
          matchNote: null,
        },
      }),
      prisma.certificate.update({
        where: {
          examId_studentId_award: {
            examId,
            studentId: rival.matchedStudentId,
            award: page.award,
          },
        },
        data: {
          stagingPageId: page.id,
          pdfKey: page.pdfKey,
          previewKey: page.previewKey,
          pageNumber: page.pageNumber,
          certNo: page.certNo,
          level: page.level,
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  // separate — เป็นคนละคน สร้างผู้เข้าสอบใหม่แยกออกมา
  const nameEn = parsed.data.nameEn || page.extractedName || null;
  const nameTh = parsed.data.nameTh || null;
  if (!nameEn && !nameTh) {
    return NextResponse.json({ error: "ต้องกรอกชื่ออย่างน้อยหนึ่งภาษา" }, { status: 400 });
  }

  const school = parsed.data.school || null;
  const student = await prisma.student.create({
    data: {
      nameTh,
      nameEn,
      school,
      nameThNormalized: normalizeName(nameTh) || null,
      nameEnNormalized: normalizeName(nameEn) || null,
      // กรอกโรงเรียนไว้ตรงนี้ รอบนำเข้าถัดไประบบจะแยกคนชื่อพ้องได้เองโดยไม่ต้องถามอีก
      schoolNormalized: normalizeSchool(school) || null,
      nameEnSortKey: nameSortKey(nameEn) || null,
    },
  });

  await prisma.$transaction([
    prisma.stagingPage.update({
      where: { id: page.id },
      data: {
        matchStatus: "MATCHED",
        matchedStudentId: student.id,
        matchedManually: true,
        matchNote: null,
      },
    }),
    prisma.certificate.create({
      data: {
        studentId: student.id,
        examId,
        batchId: page.batchId,
        stagingPageId: page.id,
        pdfKey: page.pdfKey,
        previewKey: page.previewKey,
        pageNumber: page.pageNumber,
        certNo: page.certNo,
        candidateNo: page.certNo,
        level: page.level,
        // รางวัลมาจากชื่อโฟลเดอร์ใน ZIP เสมอ
        award: page.award,
        // เผยแพร่ตามสถานะของ batch ไม่ใช่เผยแพร่ทันที
        published: page.batch.status === "PUBLISHED" ? new Date() : null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, studentId: student.id });
}
