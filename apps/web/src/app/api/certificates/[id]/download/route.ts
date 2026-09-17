import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize";
import { presignedDownloadUrl } from "@/lib/r2";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * ออกลิงก์ดาวน์โหลดแบบมีอายุแล้ว redirect ไป R2
 *
 * ไฟล์ PDF ไม่วิ่งผ่านเซิร์ฟเวอร์นี้เลย — Railway จึงไม่ต้องแบก bandwidth
 * ตอนผู้ปกครองกดโหลดพร้อมกันหลายร้อยคน และ R2 ไม่คิดค่า egress
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const limit = checkRateLimit(clientIp(await headers()));
  if (!limit.ok) {
    return NextResponse.json(
      { error: "ดาวน์โหลดถี่เกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const certificate = await prisma.certificate.findUnique({
    where: { id },
    include: { student: true, exam: { include: { program: true } } },
  });

  // เกียรติบัตรที่ยังไม่ publish ต้องถือว่าไม่มีอยู่จริง ไม่ใช่ 403
  // (ตอบ 403 เท่ากับยืนยันให้คนเดาว่า id นี้มีอยู่)
  if (!certificate || !certificate.published) {
    return NextResponse.json({ error: "ไม่พบเกียรติบัตรที่ต้องการ" }, { status: 404 });
  }

  // ชื่อไฟล์ตามสเปก: {FNAME}_{LNAME}_{รายการสอบ}_{รอบ}_{รางวัล}_{ปี}
  const slug =
    normalizeName(certificate.student.nameEn ?? certificate.student.nameTh)?.replace(/ /g, "_") ||
    "certificate";
  const { program, round, year } = certificate.exam;
  const filename = `${slug}_${program.code}_${round}_${certificate.award}_${year}.pdf`;

  const url = await presignedDownloadUrl(certificate.pdfKey, filename);
  return NextResponse.redirect(url, 302);
}
