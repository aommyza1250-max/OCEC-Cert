/**
 * ล็อกอินแอดมินด้วยรหัสผ่านเดียว + signed cookie
 *
 * เจตนาให้เรียบง่ายเพราะมีแอดมินไม่กี่คน ไม่มี user table ไม่มี OAuth
 * ถ้าวันหนึ่งต้องรู้ว่า "ใครอัปโหลด" ต้องเปลี่ยนไปใช้ตาราง users จริง ๆ
 *
 * แต่ละครั้งที่ล็อกอินได้รหัส session แบบสุ่ม ใช้บันทึกลง audit_events ว่าการแก้ไขมาจาก
 * session ไหน — บอกได้แค่นี้ ระบุตัวคนไม่ได้ เพราะทุกคนใช้รหัสผ่านเดียวกัน
 * (เก็บรหัส session ไม่ใช่ค่า cookie ทั้งก้อน เพราะค่า cookie เอาไปใช้แทนการล็อกอินได้)
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

const COOKIE_NAME = "ocec_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 ชั่วโมง — ครอบคลุมหนึ่งวันทำงาน

function sign(payload: string) {
  return createHmac("sha256", env().SESSION_SECRET).update(payload).digest("hex");
}

/** เทียบแบบ timing-safe กันการเดารหัสจากเวลาที่ใช้ตอบ */
function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyPassword(input: string) {
  return safeEqual(input, env().ADMIN_PASSWORD);
}

export function createSessionValue() {
  const sessionId = randomBytes(9).toString("base64url");
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  const payload = `${sessionId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** คืนรหัส session ถ้า cookie ถูกต้องและยังไม่หมดอายุ — cookie รูปแบบเก่า (ก่อนมีรหัส session)
 *  ถือว่าหมดอายุ แอดมินล็อกอินใหม่ครั้งเดียวหลัง deploy */
export function sessionIdFrom(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, expiresAt, signature] = parts;
  if (!sessionId || !expiresAt || !signature) return null;
  if (!safeEqual(signature, sign(`${sessionId}.${expiresAt}`))) return null;
  return Number(expiresAt) > Date.now() ? sessionId : null;
}

export async function setSessionCookie() {
  const store = await cookies();
  store.set(COOKIE_NAME, createSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function isAuthenticated() {
  const store = await cookies();
  return sessionIdFrom(store.get(COOKIE_NAME)?.value) !== null;
}

export type AdminSession = { sessionId: string };

/** ใช้ต้นทาง route handler ฝั่ง admin — โยน Response 401 ถ้ายังไม่ล็อกอิน */
export async function requireAdmin(): Promise<AdminSession> {
  const store = await cookies();
  const sessionId = sessionIdFrom(store.get(COOKIE_NAME)?.value);
  if (!sessionId) {
    throw new Response(JSON.stringify({ error: "ต้องเข้าสู่ระบบก่อน" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return { sessionId };
}
