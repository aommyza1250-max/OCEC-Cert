/**
 * ตัวช่วยของ route handler ฝั่งแอดมิน
 *
 * ทุก route ต้องตรวจล็อกอินก่อน และตอบความผิดพลาดของผู้ใช้เป็น JSON ที่มีข้อความภาษาไทย
 * เขียนซ้ำทุกไฟล์แล้วจะมีสักไฟล์ที่ลืม — รวมไว้ที่นี่ที่เดียว
 */
import { NextResponse } from "next/server";
import type { z } from "zod";
import { requireAdmin, type AdminSession } from "./auth";

/** ความผิดพลาดที่ผู้ใช้แก้ได้ (ข้อมูลไม่ครบ, สถานะไม่ถูก, ถูกแก้จากที่อื่น) — ไม่ใช่ระบบพัง */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Handler<P> = (
  request: Request,
  context: { params: P; session: AdminSession },
) => Promise<Response>;

export function adminHandler<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: Request, context: { params: Promise<P> }) => {
    let session: AdminSession;
    try {
      session = await requireAdmin();
    } catch (response) {
      return response as Response;
    }
    try {
      return await handler(request, { params: await context.params, session });
    } catch (error) {
      if (error instanceof HttpError) {
        return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
      }
      throw error;
    }
  };
}

export async function parseBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  }
  return parsed.data;
}
