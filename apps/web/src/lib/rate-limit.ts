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

function readLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
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
 * ⚠️ ต้องอ่าน **รายการขวาสุด** ของ x-forwarded-for เท่านั้น
 *
 * header นี้ผู้ใช้ส่งมาเองได้ ถ้าอ่านรายการซ้ายสุด ใครก็ตามที่ใส่
 * `x-forwarded-for: 1.2.3.4` มาเอง จะข้ามการจำกัดได้ทันทีโดยเปลี่ยนเลขไปเรื่อย ๆ
 * (ทดสอบกับของจริงแล้ว ยิง 35 ครั้งไม่โดนกันสักครั้งตอนยังอ่านรายการซ้ายสุด)
 *
 * reverse proxy ที่อยู่หน้าเรา (Railway) จะ **ต่อท้าย** IP ที่มันเห็นจริงลงไป
 * รายการขวาสุดจึงเป็นค่าเดียวที่ผู้ใช้ปลอมไม่ได้
 *
 * ด้วยเหตุผลเดียวกัน จึงไม่อ่าน cf-connecting-ip เพราะไม่มี Cloudflare
 * คั่นอยู่หน้าเว็บนี้ (Cloudflare ใช้เสิร์ฟเฉพาะไฟล์จาก R2) ใครส่ง header นั้นมาก็ได้
 */
export function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "unknown";
}
