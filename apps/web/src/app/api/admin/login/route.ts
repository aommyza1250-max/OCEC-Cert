import { NextResponse } from "next/server";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { headers } from "next/headers";

export async function POST(request: Request) {
  // จำกัดการเดารหัสผ่าน — ระบบนี้มีรหัสเดียว ถ้าไม่จำกัดจะโดน brute force ได้
  if (!checkRateLimit(`login:${clientIp(await headers())}`).ok) {
    return NextResponse.json({ error: "พยายามเข้าสู่ระบบถี่เกินไป" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!verifyPassword(password)) {
    return NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  await setSessionCookie();
  return NextResponse.json({ ok: true });
}
