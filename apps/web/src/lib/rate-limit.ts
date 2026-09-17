/**
 * จำกัดจำนวนครั้งการค้นหาต่อ IP
 *
 * เหตุผลไม่ใช่เรื่องโหลดเซิร์ฟเวอร์ แต่เป็นเรื่องความเป็นส่วนตัว (PDPA):
 * พอร์ทัลนี้ให้ใครก็ได้ค้นชื่อคนอื่น ถ้าไม่จำกัด จะมีคนไล่ยิงตัวอักษรทีละตัว
 * เพื่อดูดรายชื่อนักเรียนทั้งฐานข้อมูลออกไปได้
 *
 * เก็บใน memory ของ process — Railway รัน instance เดียวจึงพอ
 * ถ้าวันหนึ่งสเกลเป็นหลาย instance ต้องย้ายไปเก็บที่ส่วนกลาง
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30; // 30 ครั้ง/นาที — คนพิมพ์ค้นหาปกติไม่ถึง
const MAX_BUCKETS = 10_000; // กันหน่วยความจำบวมถ้าโดนยิงจากหลาย IP

export function checkRateLimit(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) evictExpired(now);
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
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

/** ดึง IP จริงหลัง proxy ของ Railway/Cloudflare */
export function clientIp(headers: Headers) {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
