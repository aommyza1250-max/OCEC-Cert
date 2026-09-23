/**
 * ข้อมูลตัวอย่างสำหรับ dev — ให้หน้าค้นหาและหน้าแอดมินทดสอบได้โดยไม่ต้องมีไฟล์จริง
 *
 * รันด้วย: pnpm db:seed   (ต้อง docker compose up -d ก่อน)
 * ปลอดภัยที่จะรันซ้ำ — ลบข้อมูล seed เดิมทิ้งก่อนทุกครั้ง
 *
 * ⚠️ ชื่อทั้งหมดในไฟล์นี้เป็นชื่อสมมติ ห้ามใส่ข้อมูลผู้เข้าสอบจริงลงไฟล์ที่ commit ขึ้น git
 */
import { PrismaClient, BatchStatus, ExamMode, ExamRound, MatchStatus } from "@prisma/client";
import { awardDisplay, profileKeyFor } from "../src/lib/certificate-catalog";
import { nameSortKey, normalizeName, normalizeSchool } from "../src/lib/normalize";
import { makePdf, makePreviewSvg, upload } from "./fake-files";

const prisma = new PrismaClient();

/** รายการสอบ + รอบ + ปี ที่จะสร้างให้ */
const PROGRAMS = [
  {
    code: "HKIMO",
    name: "Hong Kong International Mathematical Olympiad",
    exams: [
      { round: ExamRound.FINAL, year: 2026 },
      { round: ExamRound.HEAT, year: 2026 },
    ],
  },
  {
    code: "TIMO",
    name: "Thailand International Mathematical Olympiad",
    exams: [{ round: ExamRound.FINAL, year: 2025 }],
  },
];

const STUDENTS = [
  { nameEn: "SOMCHAI JAIDEE", nameTh: "สมชาย ใจดี", school: "โรงเรียนสมมติวิทยา" },
  { nameEn: "ANAN SUKSAWAT", nameTh: "อนันต์ สุขสวัสดิ์", school: "โรงเรียนตัวอย่างศึกษา" },
  { nameEn: "MALEE RUNGROJ", nameTh: "มาลี รุ่งโรจน์", school: "โรงเรียนทดสอบวิทยาคม" },
  { nameEn: "SOMCHAI JAIDEE", nameTh: "สมชาย ใจดี", school: "โรงเรียนสมมติวิทยา" },
  { nameEn: "PIYADA SRISUK", nameTh: "ปิยะดา ศรีสุข", school: "โรงเรียนตัวอย่างวิทยา" },
  { nameEn: "NATTAPONG WONGTHONG", nameTh: "ณัฐพงษ์ วงศ์ทอง", school: "โรงเรียนสาธิตสมมติ" },
  { nameEn: "KAMONCHANOK SANGCHAN", nameTh: "กมลชนก แสงจันทร์", school: "โรงเรียนสมมติศึกษา" },
  { nameEn: "THANAKRIT POONSAP", nameTh: "ธนกฤต พูลทรัพย์", school: "โรงเรียนตัวอย่างวิทยา" },
  // ชื่อซ้ำกันแต่คนละโรงเรียน — ไว้ทดสอบว่าหน้าค้นหาแสดงโรงเรียนให้แยกออก
  { nameEn: "SOMCHAI JAIDEE", nameTh: "สมชาย ใจดี", school: "โรงเรียนสาธิตสมมติ" },
];

const AWARDS = ["GOLD", "SILVER", "BRONZE", "MERIT"];
const LEVELS = ["KINDERGARTEN GROUP", "PRIMARY 3", "PRIMARY 5", "SECONDARY 1", "SENIOR SECONDARY GROUP"];

async function main() {
  console.log("ล้างข้อมูล seed เดิม...");
  // ลบตามลำดับ FK: certificates -> staging_pages -> รายชื่อ -> jobs -> batches -> students -> exams -> programs
  await prisma.auditEvent.deleteMany();
  await prisma.certificate.deleteMany();
  await prisma.stagingPage.deleteMany();
  await prisma.rosterEntry.deleteMany();
  await prisma.batch.updateMany({ data: { activeRosterImportId: null } });
  await prisma.rosterImport.deleteMany();
  await prisma.job.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.student.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.examProgram.deleteMany();

  console.log("สร้างรายการสอบและรอบนำเข้า...");
  const exams: { id: string; batchId: string; code: string; round: ExamRound; year: number }[] = [];

  for (const p of PROGRAMS) {
    const program = await prisma.examProgram.create({ data: { code: p.code, name: p.name } });
    for (const e of p.exams) {
      const exam = await prisma.exam.create({
        data: { programId: program.id, round: e.round, year: e.year },
      });
      const batch = await prisma.batch.create({
        data: {
          examId: exam.id,
          status: BatchStatus.PUBLISHED,
          note: "ข้อมูลตัวอย่างจาก seed",
          stats: { seeded: true },
          profileKey: profileKeyFor(p.code, e.round),
        },
      });
      // รายชื่อที่ใช้อยู่ของรอบนี้ — ขั้นตอนใหม่ต้องมีรายชื่อก่อนเสมอ
      const roster = await prisma.rosterImport.create({
        data: {
          batchId: batch.id,
          status: "ACTIVE",
          sourceKey: `sources/${batch.id}/roster-seed.xlsx`,
          fileName: "roster-seed.xlsx",
          activatedAt: new Date(),
        },
      });
      await prisma.batch.update({ where: { id: batch.id }, data: { activeRosterImportId: roster.id } });
      exams.push({ id: exam.id, batchId: batch.id, code: p.code, round: e.round, year: e.year });
    }
  }

  console.log("สร้างผู้เข้าสอบ + เกียรติบัตร + อัปโหลดไฟล์ตัวอย่างขึ้น MinIO...");
  let page = 0;
  let certCount = 0;

  for (const [index, s] of STUDENTS.entries()) {
    const student = await prisma.student.create({
      data: {
        nameTh: s.nameTh,
        nameEn: s.nameEn,
        school: s.school,
        nameThNormalized: normalizeName(s.nameTh),
        nameEnNormalized: normalizeName(s.nameEn),
        nameEnSortKey: nameSortKey(s.nameEn),
        schoolNormalized: normalizeSchool(s.school),
      },
    });

    // คนแรก ๆ มีเกียรติบัตรหลายรอบ เพื่อทดสอบการจัดกลุ่มในหน้าค้นหา
    const examCount = index < 3 ? exams.length : index < 6 ? 2 : 1;

    for (let i = 0; i < examCount; i++) {
      const exam = exams[i];
      const award = AWARDS[(index + i) % AWARDS.length];
      const level = LEVELS[page % LEVELS.length];
      // สลับ online/onsite ให้มีทั้งสองแบบในทุกรอบ — ใช้ในหลังบ้านเท่านั้น หน้าค้นหาไม่แสดง
      const entry = await prisma.rosterEntry.create({
        data: {
          batchId: exam.batchId,
          candidateNo: String(203000 + page + 1),
          nameEn: s.nameEn,
          nameTh: s.nameTh,
          nameEnNormalized: normalizeName(s.nameEn),
          nameThNormalized: normalizeName(s.nameTh),
          nameEnSortKey: nameSortKey(s.nameEn),
          examMode: index % 2 === 0 ? ExamMode.ONLINE : ExamMode.ONSITE,
          source: "EXCEL",
          school: s.school,
          schoolNormalized: normalizeSchool(s.school),
          level,
          rawAward: index < 3 && i === 0 ? "PERFECT SCORER" : `${award} AWARD`,
          studentId: student.id,
        },
      });
      await issue(student.id, entry, exam, award, level, ++page);
      certCount += 1;

      // 3 คนแรกในรอบแรกได้ Perfect Score เพิ่มอีกใบ — ของจริงเป็นแบบนี้
      // (ผู้ที่ทำคะแนนเต็มจะได้ทั้งใบเหรียญและใบ Perfect Score)
      if (index < 3 && i === 0) {
        await issue(student.id, entry, exam, "PERFECT_SCORE", level, ++page);
        certCount += 1;
      }
    }
  }

  console.log(
    `เสร็จแล้ว: ${PROGRAMS.length} รายการสอบ, ${exams.length} รอบ, ${STUDENTS.length} ผู้เข้าสอบ, ${certCount} เกียรติบัตร`,
  );
  console.log('ลองค้นคำว่า "SOMCHAI" หรือ "สมชาย" ที่ http://localhost:3000');
}

/** สร้างเกียรติบัตร 1 ใบ พร้อมไฟล์ตัวอย่างบน MinIO */
async function issue(
  studentId: string,
  entry: { id: string; candidateNo: string; examMode: ExamMode },
  exam: { id: string; batchId: string; code: string; round: ExamRound; year: number },
  award: string,
  level: string,
  pageNumber: number,
) {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  const certNo = entry.candidateNo;
  const shown = awardDisplay(exam.code, award);

  // ชื่อไฟล์รูปแบบเดียวกับที่ worker ตัดจริง
  const stem = [
    normalizeName(student.nameEn).replace(/ /g, "_"),
    exam.code,
    exam.round,
    award,
    exam.year,
  ].join("_");
  const pdfKey = `certificates/${exam.batchId}/${stem}.pdf`;
  const previewKey = `previews/${exam.batchId}/${stem}.svg`;

  await upload(pdfKey, makePdf(student.nameEn!, exam, award, level, certNo), "application/pdf");
  await upload(
    previewKey,
    makePreviewSvg(student.nameTh!, student.nameEn!, exam, award, level, certNo),
    "image/svg+xml",
  );

  const stagingPage = await prisma.stagingPage.create({
    data: {
      batchId: exam.batchId,
      pageNumber,
      rawText: [
        `${award} Award`,
        "This is awarded to",
        student.nameEn,
        "from THAILAND",
        `for outstanding achievement in ${level},`,
        `Hong Kong International Mathematical Olympiad ${exam.round} Round ${exam.year},`,
        `Cert No: ${certNo}`,
      ].join("\n"),
      extractedName: student.nameEn,
      extractedNameNormalized: normalizeName(student.nameEn),
      extractedNameSortKey: nameSortKey(student.nameEn),
      certNo,
      level,
      award,
      awardOnPage: award === "PERFECT_SCORE" ? null : award,
      certYear: exam.year,
      roundOnPage: exam.round,
      sourceFile: `${entry.examMode.toLowerCase()}/${award}/THAILAND_${award}.pdf`,
      pdfKey,
      previewKey,
      matchStatus: MatchStatus.MATCHED,
      matchedStudentId: studentId,
      examMode: entry.examMode,
      rosterEntryId: entry.id,
      awardLabel: shown.label,
      sourceKind: "ZIP",
    },
  });

  await prisma.certificate.create({
    data: {
      studentId,
      examId: exam.id,
      batchId: exam.batchId,
      stagingPageId: stagingPage.id,
      pdfKey,
      previewKey,
      pageNumber,
      award,
      awardLabel: shown.label,
      awardLabelTh: shown.labelTh,
      rosterEntryId: entry.id,
      certNo,
      candidateNo: certNo,
      level,
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
