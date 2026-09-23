/**
 * ทุก API ที่อัปโหลดหรือแก้ข้อมูลของรอบนำเข้า ต้องผ่านประตูเดียว (withBatchMutation / assertBatchWritable)
 *
 * เทสนี้อ่านโค้ดของ route ทุกไฟล์ ถ้ามีคนเพิ่ม route ใหม่แล้วลืมใส่ประตู เทสจะแดงทันที
 * — ลืมแล้วแปลว่าแก้ข้อมูลได้ทั้งที่รอบนั้นเผยแพร่อยู่ หรือแก้ทับงานที่กำลังประมวลผล โดยไม่มีอะไรฟ้อง
 * พฤติกรรมจริงกับฐานข้อมูล (ตอบ 409 เมื่อเผยแพร่อยู่) ทดสอบใน mutation-guard.int.test.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname);

/** route ที่ไม่ได้แก้ข้อมูลของรอบนำเข้า จึงไม่ต้องผ่านประตูนี้ — ต้องมีเหตุผลกำกับทุกตัว */
const EXEMPT: Record<string, string> = {
  "login/route.ts": "ล็อกอิน",
  "logout/route.ts": "ออกจากระบบ",
  "client-ip/route.ts": "อ่านอย่างเดียว",
  "jobs/[id]/route.ts": "อ่านสถานะงานอย่างเดียว",
  "programs/route.ts": "จัดการรายการสอบ ไม่ใช่รอบนำเข้า",
  "programs/[id]/route.ts": "จัดการรายการสอบ ไม่ใช่รอบนำเข้า",
  "retention/route.ts": "งานกวาดอายุของทั้งระบบ",
  "batches/route.ts": "สร้างรอบนำเข้าใหม่ (ยังไม่มีข้อมูลให้แก้)",
  "batches/[id]/delete/route.ts": "ลบทั้งรอบ มีการยืนยันด้วยการพิมพ์ชื่อรอบของตัวเอง",
  "batches/[id]/extend/route.ts": "ต่ออายุการเก็บ ไม่ได้แก้ข้อมูลเกียรติบัตร",
  "batches/[id]/cleanup-sources/route.ts": "เคลียร์ไฟล์ต้นฉบับ worker ตรวจเงื่อนไขเอง",
};

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === "route.ts" ? [path] : [];
  });
}

describe("ทุก route ที่แก้ข้อมูลของรอบนำเข้าต้องผ่านประตูเดียว", () => {
  for (const path of routes(ROOT)) {
    const name = relative(ROOT, path);
    const source = readFileSync(path, "utf8");
    const mutates = /export const (POST|PATCH|PUT|DELETE)\b|export async function (POST|PATCH|PUT|DELETE)\b/.test(source);
    if (!mutates) continue;

    it(name, () => {
      if (EXEMPT[name]) return;
      expect(source, `${name} ต้องเรียก withBatchMutation หรือ assertBatchWritable`).toMatch(
        /withBatchMutation\(|assertBatchWritable\(/,
      );
    });
  }
});
