/**
 * ไฟล์ตัวอย่างปลอมสำหรับ dev — รูป preview และ PDF ที่ "ดูเหมือนเกียรติบัตร" พอให้ทดสอบหน้าเว็บได้
 *
 * ใช้ร่วมกันระหว่าง prisma/seed.ts (ข้อมูลตัวอย่างทั้งชุด) และ prisma/mock-person.ts
 * (เพิ่มคนเดียวเข้าไปในฐานที่มีข้อมูลอยู่แล้ว) — ต้องอยู่ที่เดียว ไม่งั้นแก้ที่หนึ่งลืมอีกที่
 *
 * ⚠️ ไฟล์ที่สร้างจากที่นี่ไม่ใช่เกียรติบัตรจริง ใช้ได้แค่ใน dev
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

/** รายการสอบ + รอบ + ปี ที่ไฟล์ตัวอย่างใบนี้อ้างถึง */
export type ExamRef = { code: string; round: string; year: number };

export async function upload(key: string, body: Buffer | string, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

/** ภาพตัวอย่างปลอมสำหรับ dev — ของจริง worker จะเรนเดอร์เป็น WebP จากหน้า PDF */
export function makePreviewSvg(
  nameTh: string,
  nameEn: string,
  exam: ExamRef,
  award: string,
  level: string,
  certNo: string,
) {
  const esc = (t: string) =>
    t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="842" height="595" viewBox="0 0 842 595">
  <rect width="842" height="595" fill="#fdfcf7"/>
  <rect x="18" y="18" width="806" height="559" fill="none" stroke="#b08d3f" stroke-width="6"/>
  <rect x="32" y="32" width="778" height="531" fill="none" stroke="#b08d3f" stroke-width="1.5"/>
  <text x="70" y="70" font-family="sans-serif" font-size="16" fill="#9ca3af">Cert No: ${esc(certNo)}</text>
  <text x="421" y="130" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#8a6d2f">${esc(award.replace("_", " "))} Award</text>
  <text x="421" y="185" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#8a6d2f">This is awarded to</text>
  <text x="421" y="265" text-anchor="middle" font-family="sans-serif" font-size="44" font-weight="bold" fill="#1f2937">${esc(nameEn)}</text>
  <text x="421" y="310" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#4b5563">${esc(nameTh)}</text>
  <text x="421" y="360" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#374151">from THAILAND</text>
  <text x="421" y="400" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#374151">for outstanding achievement in ${esc(level)}</text>
  <text x="421" y="450" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#374151">${esc(exam.code)} ${esc(exam.round)} Round ${exam.year}</text>
  <text x="421" y="535" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#9ca3af">ตัวอย่างสำหรับทดสอบระบบ ไม่ใช่เกียรติบัตรจริง</text>
</svg>`;
}

/**
 * สร้าง PDF หน้าเดียวแบบมือ เพื่อไม่ต้องลงไลบรารีเพิ่มแค่สำหรับข้อมูลตัวอย่าง
 * ใช้ WinAnsi จึงรองรับเฉพาะตัวอักษรละติน — พอสำหรับทดสอบปุ่มดาวน์โหลด
 */
export function makePdf(
  nameEn: string,
  exam: ExamRef,
  award: string,
  level: string,
  certNo: string,
) {
  const esc = (t: string) => t.replace(/([\\()])/g, "\\$1").replace(/[^\x20-\x7e]/g, "?");
  const content = `BT /F1 12 Tf 72 540 Td (Cert No: ${esc(certNo)}) Tj ET
BT /F1 18 Tf 72 505 Td (${esc(award.replace("_", " "))} Award) Tj ET
BT /F1 28 Tf 72 465 Td (${esc(nameEn)}) Tj ET
BT /F1 14 Tf 72 430 Td (for outstanding achievement in ${esc(level)}) Tj ET
BT /F1 14 Tf 72 405 Td (${esc(exam.code)} ${esc(exam.round)} Round ${exam.year}) Tj ET
BT /F1 10 Tf 72 370 Td (Sample data for development - not a real certificate) Tj ET`;

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
