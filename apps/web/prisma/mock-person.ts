/**
 * เพิ่มผู้เข้าสอบสมมติ 1 คนเข้าไปในฐานข้อมูล dev — ไว้ดูหน้าค้นหาเวลามีหลายรายการสอบ
 *
 * รันด้วย: pnpm db:mock          เพิ่ม/สร้างใหม่ทับของเดิม
 *          pnpm db:mock --remove ลบออก
 *
 * ต่างจาก prisma/seed.ts ที่ล้างฐานทั้งหมดก่อน — ไฟล์นี้ **ไม่แตะข้อมูลอื่นเลย**
 * จึงเรียกได้ทับรอบนำเข้าจริงที่กำลังทดสอบอยู่ โดยไม่ทำให้ของเดิมหาย
 *
 * ⚠️ ชื่อในไฟล์นี้เป็นชื่อสมมติ ห้ามเปลี่ยนเป็นชื่อผู้เข้าสอบจริงแล้ว commit
 */
import { BatchStatus, MatchStatus, PrismaClient } from "@prisma/client";
import { nameSortKey, normalizeName, normalizeSchool } from "../src/lib/normalize";
import { makePdf, makePreviewSvg, upload } from "./fake-files";

const prisma = new PrismaClient();

/** ป้ายกำกับของสิ่งที่สคริปต์นี้สร้าง เอาไว้หาเพื่อลบทิ้งตอนรันซ้ำ */
const MOCK_NOTE = "ข้อมูลสมมติจาก pnpm db:mock";

const PERSON = {
  nameTh: "สมมติ ทดสอบระบบ",
  nameEn: "SOMMOT THODSOBRABOB",
  // ไม่ใส่โรงเรียน เพื่อให้เหมือนข้อมูลจริง — เกียรติบัตรไม่มีข้อความโรงเรียน
  // และชีทรายชื่อก็ไม่มีคอลัมน์โรงเรียน หน้าเว็บจะแสดงระดับชั้นแทน
  school: null as string | null,
};

const PROGRAMS = [
  { code: "HKIMO", name: "Hong Kong International Mathematical Olympiad" },
  { code: "TIMO", name: "Thailand International Mathematical Olympiad" },
];

/** เกียรติบัตรที่จะออกให้ — เรียงตามที่เขียนไว้ ไม่ได้เรียงตามที่หน้าเว็บจะแสดง
 *  (หน้าเว็บเรียงเอง: รายการสอบที่มีปีล่าสุดขึ้นก่อน แล้วรอบชิงชนะเลิศก่อนรอบคัดเลือก) */
const CERTIFICATES = [
  // HKIMO มีแค่รอบคัดเลือก ปี 2025
  { code: "HKIMO", round: "HEAT", year: 2025, award: "SILVER", level: "PRIMARY 3" },
  // TIMO ปี 2026 สอบทั้งสองรอบ — รอบชิงชนะเลิศได้คะแนนเต็มจึงได้ 2 ใบ
  { code: "TIMO", round: "HEAT", year: 2026, award: "MERIT", level: "PRIMARY 4" },
  { code: "TIMO", round: "FINAL", year: 2026, award: "GOLD", level: "PRIMARY 4" },
  { code: "TIMO", round: "FINAL", year: 2026, award: "PERFECT_SCORE", level: "PRIMARY 4" },
];

async function main() {
  const remove = process.argv.includes("--remove");

  await clean();
  if (remove) {
    console.log("ลบผู้เข้าสอบสมมติออกแล้ว");
    return;
  }

  const student = await prisma.student.create({
    data: {
      nameTh: PERSON.nameTh,
      nameEn: PERSON.nameEn,
      school: PERSON.school,
      nameThNormalized: normalizeName(PERSON.nameTh),
      nameEnNormalized: normalizeName(PERSON.nameEn),
      nameEnSortKey: nameSortKey(PERSON.nameEn),
      schoolNormalized: PERSON.school ? normalizeSchool(PERSON.school) : null,
    },
  });

  let pageNumber = 0;
  for (const c of CERTIFICATES) {
    const program = PROGRAMS.find((p) => p.code === c.code)!;
    // รายการสอบกับรอบอาจมีอยู่แล้วจากข้อมูลจริงที่ทดสอบไว้ — ใช้ของเดิม ไม่สร้างซ้ำ
    const examProgram = await prisma.examProgram.upsert({
      where: { code: program.code },
      update: {},
      create: { code: program.code, name: program.name },
    });
    const exam = await prisma.exam.upsert({
      where: {
        programId_round_year: {
          programId: examProgram.id,
          round: c.round as "HEAT" | "FINAL",
          year: c.year,
        },
      },
      update: {},
      create: {
        programId: examProgram.id,
        round: c.round as "HEAT" | "FINAL",
        year: c.year,
      },
    });
    // รอบนำเข้าเป็นของสคริปต์นี้เอง ติดป้าย MOCK_NOTE ไว้ให้ลบออกได้สะอาด
    const batch = await prisma.batch.upsert({
      where: { id: await mockBatchId(exam.id) },
      update: {},
      create: {
        examId: exam.id,
        status: BatchStatus.PUBLISHED,
        note: MOCK_NOTE,
        stats: { mock: true },
      },
    });

    await issue(student.id, { code: c.code, round: c.round, year: c.year }, exam.id, batch.id, {
      award: c.award,
      level: c.level,
      pageNumber: ++pageNumber,
    });
  }

  console.log(`สร้างเสร็จ: ${PERSON.nameTh} (${PERSON.nameEn}) — ${CERTIFICATES.length} ใบ`);
  console.log("ลองค้นคำว่า \"SOMMOT\" ที่ http://localhost:3000 (ระบบค้นจากชื่ออังกฤษเท่านั้น)");
  console.log("ที่ควรเห็น: TIMO อยู่บน (ปี 2026 · รอบชิงชนะเลิศ 2 ใบ, ปี 2026 · รอบคัดเลือก 1 ใบ)");
  console.log("            แล้วต่อด้วย HKIMO (ปี 2025 · รอบคัดเลือก 1 ใบ)");
}

/** id ของรอบนำเข้าสมมติของ exam นี้ ถ้ามีอยู่แล้วใช้ตัวเดิม ไม่งั้นสุ่มใหม่ */
async function mockBatchId(examId: string): Promise<string> {
  const existing = await prisma.batch.findFirst({ where: { examId, note: MOCK_NOTE } });
  return existing?.id ?? crypto.randomUUID();
}

/** ลบเฉพาะของที่สคริปต์นี้สร้าง — คนสมมติและรอบนำเข้าที่ติดป้าย MOCK_NOTE
 *  ไม่ลบรายการสอบกับรอบการสอบ เพราะข้อมูลจริงอาจอ้างอยู่ */
async function clean() {
  const { count } = await prisma.student.deleteMany({ where: { nameEn: PERSON.nameEn } });
  const batches = await prisma.batch.deleteMany({ where: { note: MOCK_NOTE } });
  if (count || batches.count) {
    console.log(`ลบของเดิม: ผู้เข้าสอบ ${count} คน, รอบนำเข้า ${batches.count} รอบ`);
  }
}

/** สร้างเกียรติบัตร 1 ใบ พร้อมไฟล์ตัวอย่างบน MinIO ให้เหมือนที่ worker ทำจริง */
async function issue(
  studentId: string,
  exam: { code: string; round: string; year: number },
  examId: string,
  batchId: string,
  cert: { award: string; level: string; pageNumber: number },
) {
  const certNo = String(900000 + cert.pageNumber); // เลขชุด 9xxxxx ไม่ชนกับของจริง
  const stem = [
    normalizeName(PERSON.nameEn).replace(/ /g, "_"),
    exam.code,
    exam.round,
    cert.award,
    exam.year,
  ].join("_");
  const pdfKey = `certificates/${batchId}/${stem}.pdf`;
  const previewKey = `previews/${batchId}/${stem}.svg`;

  await upload(pdfKey, makePdf(PERSON.nameEn, exam, cert.award, cert.level, certNo), "application/pdf");
  await upload(
    previewKey,
    makePreviewSvg(PERSON.nameTh, PERSON.nameEn, exam, cert.award, cert.level, certNo),
    "image/svg+xml",
  );

  const stagingPage = await prisma.stagingPage.create({
    data: {
      batchId,
      pageNumber: cert.pageNumber,
      rawText: [
        `${cert.award} Award`,
        "This is awarded to",
        PERSON.nameEn,
        "from THAILAND",
        `for outstanding achievement in ${cert.level},`,
        `${exam.code} ${exam.round} Round ${exam.year},`,
        `Cert No: ${certNo}`,
      ].join("\n"),
      extractedName: PERSON.nameEn,
      extractedNameNormalized: normalizeName(PERSON.nameEn),
      extractedNameSortKey: nameSortKey(PERSON.nameEn),
      certNo,
      level: cert.level,
      award: cert.award,
      // หน้า Perfect Score ของจริงไม่มีข้อความรางวัลพิมพ์อยู่
      awardOnPage: cert.award === "PERFECT_SCORE" ? null : cert.award,
      certYear: exam.year,
      roundOnPage: exam.round,
      sourceFile: `${exam.code}/${cert.award}/MOCK.pdf`,
      pdfKey,
      previewKey,
      matchStatus: MatchStatus.MATCHED,
      matchedStudentId: studentId,
    },
  });

  await prisma.certificate.create({
    data: {
      studentId,
      examId,
      batchId,
      stagingPageId: stagingPage.id,
      pdfKey,
      previewKey,
      pageNumber: cert.pageNumber,
      award: cert.award,
      certNo,
      candidateNo: certNo,
      level: cert.level,
      published: new Date(),
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
