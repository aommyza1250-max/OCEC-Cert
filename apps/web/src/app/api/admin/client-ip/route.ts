/**
 * ดูว่า header เรื่อง IP ที่วิ่งมาถึงแอปหน้าตาเป็นยังไงจริง ๆ
 *
 * การจำกัดจำนวนครั้งต่อ IP พึ่งค่าพวกนี้ และเคยเดาผิดมาแล้วสองรอบจนกันอะไรไม่ได้เลย
 * หน้านี้จึงมีไว้ให้ "ดูของจริง" แทนการเดา — ต้องใช้ทุกครั้งที่ย้ายผู้ให้บริการ
 * หรือเพิ่ม proxy/CDN คั่นหน้าเว็บ วิธีอ่านผลอยู่ใน docs/rate-limit-ip.md
 *
 * อ่านอย่างเดียว ไม่แตะฐานข้อมูลและไม่แตะไฟล์ใด ๆ
 * ต้องเข้าสู่ระบบแอดมินก่อนถึงจะเรียกได้ เพราะค่าที่คืนออกมาเป็นข้อมูลโครงสร้างภายใน
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rateLimitSettings } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** ไอดีสุ่มตอน process เริ่มทำงาน — เปิดหน้านี้ซ้ำหลายครั้งแล้วนับว่าได้กี่ค่า
 *  จะรู้ว่า Railway รันอยู่กี่ instance ซึ่งมีผลกับตัวนับที่เก็บใน memory */
const PROCESS_ID = Math.random().toString(36).slice(2, 10);

const IP_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-envoy-external-address",
  "x-envoy-internal",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "forwarded",
  "x-railway-edge",
  "x-railway-request-id",
  "x-request-start",
];

export async function GET() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const h = await headers();
  const seen: Record<string, string> = {};
  for (const name of IP_HEADERS) {
    const value = h.get(name);
    if (value !== null) seen[name] = value;
  }

  return NextResponse.json({
    processId: PROCESS_ID,
    // ค่าลิมิตที่ service นี้ใช้อยู่จริง — 0 แปลว่าปิดการจำกัดอยู่
    limits: rateLimitSettings(),
    seen,
    allHeaderNames: [...h.keys()].sort(),
  });
}
