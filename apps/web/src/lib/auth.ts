/**
 * ล็อกอินแอดมินด้วยรหัสผ่านเดียว + signed cookie
 *
 * เจตนาให้เรียบง่ายเพราะมีแอดมินไม่กี่คน ไม่มี user table ไม่มี OAuth
 * ถ้าวันหนึ่งต้องรู้ว่า "ใครอัปโหลด" ต้องเปลี่ยนไปใช้ตาราง users จริง ๆ
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
}

function isValidSession(value: string | undefined) {
  if (!value) return false;
  const [expiresAt, signature] = value.split(".");
  if (!expiresAt || !signature) return false;
  if (!safeEqual(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
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
  return isValidSession(store.get(COOKIE_NAME)?.value);
}

/** ใช้ต้นทาง route handler ฝั่ง admin — โยน Response 401 ถ้ายังไม่ล็อกอิน */
export async function requireAdmin() {
  if (!(await isAuthenticated())) {
    throw new Response(JSON.stringify({ error: "ต้องเข้าสู่ระบบก่อน" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
}
