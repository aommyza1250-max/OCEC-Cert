/**
 * จำกัดจำนวนครั้งต่อ IP
 *
 * เหตุผลไม่ใช่เรื่องโหลดเซิร์ฟเวอร์ แต่เป็นเรื่องความเป็นส่วนตัว (PDPA):
 * พอร์ทัลนี้ให้ใครก็ได้ค้นชื่อคนอื่น ถ้าไม่จำกัด จะมีคนไล่ยิงเพื่อดูดรายชื่อออกไป
 *
 * **ข้อจำกัดที่ต้องรู้:** นี่เป็นแค่เครื่องกีดขวาง ไม่ใช่กำแพง
 * คนที่ตั้งใจจริงและมีหลาย IP ยังทำได้อยู่ดี ตัวป้องกันจริงคือต้องรู้ชื่อก่อนถึงจะค้นเจอ
 * บวกกับการบังคับพิมพ์อย่างน้อย 3 ตัวอักษรและจำกัดผลลัพธ์ต่อครั้ง
 *
 * เก็บใน memory ของ process — ใช้ได้เมื่อรัน instance เดียว
 * ถ้าวันหนึ่งเพิ่มเป็นหลาย instance ต้องย้ายไปเก็บที่ส่วนกลางก่อน ไม่งั้นการนับจะเพี้ยน
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000; // กันหน่วยความจำบวมถ้าโดนยิงจากหลาย IP

/**
 * ค้นหา: ตั้งสูงพอที่ผู้ใช้จริงหลายคนหลัง IP เดียวกันจะไม่โดนกัน
 *
 * ผู้ปกครองในโรงเรียนหรือออฟฟิศเดียวกันออกเน็ตด้วย IP เดียว
 * ถ้าตั้งต่ำเกินไป คนที่ 31 ในนาทีนั้นจะโดนกันทั้งที่ไม่ได้ทำอะไรผิด
 *
 * ตั้ง SEARCH_RATE_LIMIT_PER_MIN=0 เพื่อปิดชั่วคราวตอนทดสอบโหลด
 */
const SEARCH_LIMIT = readLimit("SEARCH_RATE_LIMIT_PER_MIN", 300);

/** เข้าสู่ระบบ: เข้มไว้ เพราะมีรหัสผ่านเดียวและต้องกันการเดารหัส */
const LOGIN_LIMIT = readLimit("LOGIN_RATE_LIMIT_PER_MIN", 10);

export function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  // ไม่ได้ตั้ง หรือตั้งเป็นค่าว่าง = ใช้ค่าปริยาย
  // ต้องแยกสองกรณีนี้ออกจาก "0" ให้ชัด เพราะช่องค่าว่างใน Railway กดพลาดง่ายมาก
  // และถ้านับเป็น 0 เท่ากับปิดการจำกัดทิ้งไปเงียบ ๆ โดยไม่มีอะไรฟ้อง
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** ค่าลิมิตที่ใช้อยู่จริง — ให้หน้าแอดมินเรียกดูได้ จะได้ไม่ต้องเดาว่าตั้งค่าอะไรไว้บนเซิร์ฟเวอร์ */
export function rateLimitSettings() {
  return { search: SEARCH_LIMIT, login: LOGIN_LIMIT };
}

// ปิดการจำกัดคือเรื่องใหญ่ ต้องเห็นใน log ตั้งแต่ตอน service เริ่มทำงาน
// ไม่ใช่มารู้ตอนยิงทดสอบแล้วงงว่าทำไมกันไม่ได้ (เคยเกิดมาแล้ว)
for (const [name, limit] of [
  ["SEARCH_RATE_LIMIT_PER_MIN", SEARCH_LIMIT],
  ["LOGIN_RATE_LIMIT_PER_MIN", LOGIN_LIMIT],
] as const) {
  if (limit === 0) {
    console.warn(`[rate-limit] ${name}=0 — ปิดการจำกัดจำนวนครั้งอยู่ ห้ามใช้ค่านี้ตอนเปิดใช้งานจริง`);
  }
}

export type RateLimitPurpose = "search" | "login";

export function checkRateLimit(
  key: string,
  purpose: RateLimitPurpose = "search",
): { ok: boolean; retryAfterSec: number } {
  const limit = purpose === "login" ? LOGIN_LIMIT : SEARCH_LIMIT;
  if (limit === 0) return { ok: true, retryAfterSec: 0 }; // ปิดไว้ (เช่นตอนทดสอบโหลด)

  const now = Date.now();
  const bucketKey = `${purpose}:${key}`;
  const bucket = buckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) evictExpired(now);
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

function evictExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // ถ้าหมดอายุไม่พอให้ล้าง ให้ทิ้งทั้งกระดานดีกว่าปล่อยให้แรมบวม
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/**
 * IP ของผู้ใช้จริง
 *
 * **อ่าน `x-real-ip` เป็นหลัก** — Railway (Envoy) เป็นคนใส่ค่านี้เองจากผู้ที่เชื่อมต่อเข้ามาจริง
 * ค่าที่ตรวจกับ production แล้ว (ผ่านหน้าแอดมิน) หน้าตาเป็นแบบนี้:
 *
 *   x-forwarded-for: 27.130.180.201, 152.233.68.97
 *                    └ IP ผู้ใช้จริง ┘  └ proxy ภายในของ Railway ┘
 *   x-real-ip:       27.130.180.201
 *
 * ประวัติที่พลาดมาแล้วสองรอบ อย่าให้พลาดรอบที่สาม:
 *
 *  1. เคยอ่าน `x-forwarded-for` ตัว **ซ้ายสุด** — ผู้ใช้ส่ง header นี้มาเองได้
 *     ยิงทดสอบ 35 ครั้งด้วยเลขปลอมคนละค่า ผ่านหมดทั้ง 35 ทั้งที่ลิมิตอยู่ที่ 30
 *
 *  2. แก้เป็นอ่าน **ขวาสุด** โดยเดาว่า proxy จะต่อท้าย IP จริงลงไป — ไม่จริงสำหรับ Railway
 *     ขวาสุดคือ IP ของ proxy ภายใน ซึ่งไม่ผูกกับตัวผู้ใช้เลยและเปลี่ยนไปตาม proxy ที่รับงาน
 *     ผลคือการนับมั่ว ยิง 340 ครั้งไม่โดนกันสักครั้ง ทั้งที่ปลอม header และไม่ปลอม
 *
 * ถ้าวันหนึ่งย้ายออกจาก Railway **ต้องตรวจใหม่ว่า proxy เจ้าใหม่ใส่ IP จริงไว้ที่ไหน**
 * วิธีตรวจอยู่ใน docs/rate-limit-ip.md
 *
 * ด้วยเหตุผลเดียวกัน จึงไม่อ่าน cf-connecting-ip เพราะไม่มี Cloudflare
 * คั่นอยู่หน้าเว็บนี้ (Cloudflare ใช้เสิร์ฟเฉพาะไฟล์จาก R2) ใครส่ง header นั้นมาก็ได้
 */
export function clientIp(headers: Headers) {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  // ไม่มี x-real-ip แปลว่าไม่ได้อยู่หลัง Railway (เช่นรันในเครื่องตอน dev)
  // ใช้ตัวซ้ายสุดของ x-forwarded-for ซึ่งเป็นตำแหน่งที่ proxy ส่วนใหญ่ใส่ IP ผู้ใช้ไว้
  // ค่านี้ปลอมได้ถ้าไม่มี proxy คั่น จึงใช้เป็นทางสำรองเท่านั้น
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  return hops[0] ?? "unknown";
}
