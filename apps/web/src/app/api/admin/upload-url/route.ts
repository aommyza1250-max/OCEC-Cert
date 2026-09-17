import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { keys, presignedUploadUrl } from "@/lib/r2";

const schema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["zip", "excel"]),
});

const CONTENT_TYPES = {
  zip: "application/zip",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/**
 * ออกลิงก์อัปโหลดให้เบราว์เซอร์ยิงไฟล์ขึ้น R2 ตรง ๆ
 *
 * ไฟล์ ZIP เกียรติบัตรมักมีหลายร้อยหน้า ขนาดหลายร้อย MB
 * ถ้าปล่อยให้วิ่งผ่าน Next.js API เซิร์ฟเวอร์บน Railway จะกินแรมจนถูกฆ่า
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { batchId, kind } = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "ไม่พบรอบการนำเข้านี้" }, { status: 404 });

  const key = kind === "zip" ? keys.sourceZip(batchId) : keys.sourceExcel(batchId);
  const url = await presignedUploadUrl(key, CONTENT_TYPES[kind]);

  return NextResponse.json({ url, key, contentType: CONTENT_TYPES[kind] });
}
