import { NextResponse, type NextRequest } from "next/server";

/**
 * กันไม่ให้เข้าหน้า /admin โดยไม่ล็อกอิน
 *
 * middleware รันบน edge runtime ซึ่งใช้ node:crypto ไม่ได้ จึงตรวจแค่ว่า "มี cookie ไหม"
 * การตรวจลายเซ็นจริงเกิดที่ route handler / server component ผ่าน requireAdmin()
 * ชั้นนี้มีไว้เพื่อ redirect ให้ผู้ใช้เห็นหน้า login เร็ว ๆ ไม่ใช่ชั้นความปลอดภัยหลัก
 */
export function middleware(request: NextRequest) {
  if (request.cookies.get("ocec_admin")) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // ทุกหน้าใต้ /admin ยกเว้นหน้า login เอง
  matcher: ["/admin", "/admin/((?!login).*)"],
};
