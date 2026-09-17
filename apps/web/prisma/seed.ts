/**
 * ข้อมูลตัวอย่างสำหรับ dev — ให้หน้าค้นหาและหน้าดาวน์โหลดทดสอบได้ก่อนที่ worker จะเสร็จ
 *
 * รันด้วย: pnpm db:seed   (ต้อง docker compose up -d ก่อน)
 * ปลอดภัยที่จะรันซ้ำ — ลบข้อมูล seed เดิมทิ้งก่อนทุกครั้ง
 *
 * ⚠️ ชื่อทั้งหมดในไฟล์นี้เป็นชื่อสมมติ ห้ามใส่ข้อมูลผู้เข้าสอบจริงลงไฟล์ที่ commit ขึ้น git
 */
import { PrismaClient, ExamKind, BatchStatus, MatchStatus } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { nameSortKey, normalizeName, normalizeSchool } from "../src/lib/normalize";

const prisma = new PrismaClient();

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const BUCKET = process.env.R2_BUCKET!;

/** รายการสอบ + ปีการศึกษาที่จะสร้างให้ — code คือสิ่งที่ไปต่อท้ายชื่อไฟล์ */
const PROGRAMS = [
  {
    code: "HKIMO",
    name: "Hong Kong International Mathematical Olympiad",
    kind: ExamKind.INTERNATIONAL,
    years: [2567, 2566],
  },
  {
    code: "TIMO",
    name: "Thailand International Mathematical Olympiad",
    kind: ExamKind.INTERNATIONAL,
    years: [2567],
  },
  {
    code: "SCIMO",
    name: "การแข่งขันวิทยาศาสตร์ระดับมัธยมศึกษาตอนต้น",
    kind: ExamKind.DOMESTIC,
    years: [2567],
  },
];

const STUDENTS = [
  { nameTh: "สมชาย ใจดี", nameEn: "Somchai Jaidee", school: "โรงเรียนสวนกุหลาบวิทยาลัย" },
  { nameTh: "สมหญิง รักเรียน", nameEn: "Somying Rakrian", school: "โรงเรียนเตรียมอุดมศึกษา" },
  { nameTh: "ปิยะดา ศรีสุข", nameEn: "Piyada Srisuk", school: "โรงเรียนสตรีวิทยา" },
  { nameTh: "ณัฐพงษ์ วงศ์ทอง", nameEn: "Nattapong Wongthong", school: "โรงเรียนสวนกุหลาบวิทยาลัย" },
  { nameTh: "กมลชนก แสงจันทร์", nameEn: "Kamonchanok Sangchan", school: "โรงเรียนราชวินิต" },
  { nameTh: "ธนกฤต พูลทรัพย์", nameEn: "Thanakrit Poonsap", school: "โรงเรียนเทพศิรินทร์" },
  { nameTh: "อารยา นิลกาฬ", nameEn: "Araya Nilakan", school: "โรงเรียนสตรีวิทยา" },
  { nameTh: "ภูวดล เกษมสุข", nameEn: "Phuwadol Kasemsuk", school: "โรงเรียนอัสสัมชัญ" },
  { nameTh: "จิราพร ทองดี", nameEn: "Jiraporn Thongdee", school: "โรงเรียนราชวินิต" },
  { nameTh: "วรากร สุขสวัสดิ์", nameEn: "Warakorn Suksawat", school: "โรงเรียนเทพศิรินทร์" },
  // ชื่อซ้ำกันแต่คนละคน (คนละโรงเรียน) — ไว้ทดสอบว่าระบบแยกสองคนนี้ออกจากกัน
  // และหน้าค้นหาต้องแสดงโรงเรียนให้ผู้ปกครองดูออกว่าใบไหนของลูกตัวเอง
  { nameTh: "สมชาย ใจดี", nameEn: "Somchai Jaidee", school: "โรงเรียนเทพศิรินทร์" },
];

const AWARDS = ["เหรียญทอง", "เหรียญเงิน", "เหรียญทองแดง", "เกียรติบัตรเข้าร่วม", null];
const LEVELS = ["Primary 4", "Primary 5", "Primary 6", "Secondary 1", "Secondary 2"];

async function main() {
  console.log("ล้างข้อมูล seed เดิม...");
  // ลบตามลำดับ FK: certificates -> staging_pages -> jobs -> batches -> students -> exams -> programs
  await prisma.certificate.deleteMany();
  await prisma.stagingPage.deleteMany();
  await prisma.job.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.student.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.examProgram.deleteMany();

  console.log("สร้างรายการสอบ...");
  // exams แต่ละตัวคือ "รายการสอบ x ปีการศึกษา" — batch ผูกกับตัวนี้
  const exams: { id: string; code: string; batchId: string }[] = [];

  for (const p of PROGRAMS) {
    const program = await prisma.examProgram.create({
      data: { code: p.code, name: p.name, kind: p.kind },
    });

    for (const academicYear of p.years) {
      const exam = await prisma.exam.create({
        data: { programId: program.id, academicYear },
      });
      const batch = await prisma.batch.create({
        data: {
          examId: exam.id,
          status: BatchStatus.PUBLISHED,
          note: "ข้อมูลตัวอย่างจาก seed",
          stats: { seeded: true },
        },
      });
      exams.push({ id: exam.id, code: p.code, batchId: batch.id });
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
        nameThNormalized: normalizeName(s.nameTh),
        nameEnNormalized: normalizeName(s.nameEn),
        nameEnSortKey: nameSortKey(s.nameEn),
        school: s.school,
        schoolNormalized: normalizeSchool(s.school),
      },
    });

    // คนแรก ๆ ได้หลายรายการสอบ/หลายปี เพื่อทดสอบการจัดกลุ่ม
    const examCount = index < 3 ? exams.length : index < 7 ? 2 : 1;

    for (let i = 0; i < examCount; i++) {
      page += 1;
      const exam = exams[i];
      const level = LEVELS[page % LEVELS.length];
      const certNo = String(50000 + page);

      // ชื่อไฟล์รูปแบบเดียวกับที่ worker ตัดจริง: {FNAME}_{LNAME}_{CODE}
      const stem = `${normalizeName(s.nameEn).replace(/ /g, "_")}_${exam.code}`;
      const pdfKey = `certificates/${exam.batchId}/${stem}.pdf`;
      const previewKey = `previews/${exam.batchId}/${stem}.svg`;

      await upload(pdfKey, makePdf(s.nameEn, exam.code, level, certNo), "application/pdf");
      await upload(
        previewKey,
        makePreviewSvg(s.nameTh, s.nameEn, exam.code, level, certNo),
        "image/svg+xml",
      );

      const stagingPage = await prisma.stagingPage.create({
        data: {
          batchId: exam.batchId,
          pageNumber: page,
          rawText: `Certificate No: ${certNo}\nThis is awarded to\n${s.nameEn.toUpperCase()}\nfrom THAILAND\nfor outstanding achievement in ${level}`,
          extractedName: s.nameEn.toUpperCase(),
          extractedNameNormalized: normalizeName(s.nameEn),
          extractedNameSortKey: nameSortKey(s.nameEn),
          certNo,
          level,
          pdfKey,
          previewKey,
          matchStatus: MatchStatus.MATCHED,
          matchedStudentId: student.id,
        },
      });

      await prisma.certificate.create({
        data: {
          studentId: student.id,
          examId: exam.id,
          batchId: exam.batchId,
          stagingPageId: stagingPage.id,
          pdfKey,
          previewKey,
          pageNumber: page,
          award: AWARDS[page % AWARDS.length],
          certNo,
          level,
          published: new Date(),
        },
      });
      certCount += 1;
    }
  }

  console.log(
    `เสร็จแล้ว: ${PROGRAMS.length} รายการสอบ, ${exams.length} รอบ, ${STUDENTS.length} ผู้เข้าสอบ, ${certCount} เกียรติบัตร`,
  );
  console.log('ลองค้นคำว่า "สมชาย" หรือ "somchai" ที่ http://localhost:3000');
}

async function upload(key: string, body: Buffer | string, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

/** ภาพตัวอย่างปลอมสำหรับ dev — ของจริง worker จะเรนเดอร์เป็น WebP จากหน้า PDF */
function makePreviewSvg(
  nameTh: string,
  nameEn: string,
  examCode: string,
  level: string,
  certNo: string,
) {
  const esc = (t: string) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="842" height="595" viewBox="0 0 842 595">
  <rect width="842" height="595" fill="#fdfcf7"/>
  <rect x="18" y="18" width="806" height="559" fill="none" stroke="#b08d3f" stroke-width="6"/>
  <rect x="32" y="32" width="778" height="531" fill="none" stroke="#b08d3f" stroke-width="1.5"/>
  <text x="421" y="150" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#8a6d2f">เกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า</text>
  <text x="421" y="250" text-anchor="middle" font-family="sans-serif" font-size="52" font-weight="bold" fill="#1f2937">${esc(nameTh)}</text>
  <text x="421" y="305" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#4b5563">${esc(nameEn)}</text>
  <text x="421" y="390" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#374151">${esc(examCode)} — ${esc(level)}</text>
  <text x="70" y="70" font-family="sans-serif" font-size="16" fill="#9ca3af">Certificate No: ${esc(certNo)}</text>
  <text x="421" y="530" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#9ca3af">ตัวอย่างสำหรับทดสอบระบบ (seed data)</text>
</svg>`;
}

/**
 * สร้าง PDF หน้าเดียวแบบมือ เพื่อไม่ต้องลงไลบรารีเพิ่มแค่สำหรับ seed
 * ใช้ WinAnsi จึงรองรับเฉพาะตัวอักษรละติน — พอสำหรับทดสอบปุ่มดาวน์โหลด
 */
function makePdf(nameEn: string, examCode: string, level: string, certNo: string) {
  const esc = (t: string) => t.replace(/([\\()])/g, "\\$1").replace(/[^\x20-\x7e]/g, "?");
  const content = `BT /F1 12 Tf 72 540 Td (Certificate No: ${esc(certNo)}) Tj ET
BT /F1 28 Tf 72 500 Td (${esc(nameEn)}) Tj ET
BT /F1 14 Tf 72 460 Td (${esc(examCode)} - ${esc(level)}) Tj ET
BT /F1 10 Tf 72 420 Td (Seed data for development - not a real certificate) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
