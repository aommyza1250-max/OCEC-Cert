import { describe, expect, it } from "vitest";
import { clientIp } from "./rate-limit";

const headers = (values: Record<string, string>) => new Headers(values);

describe("clientIp", () => {
  it("อ่านค่าที่ proxy ต่อท้ายไว้ ไม่ใช่ค่าที่ผู้ใช้ส่งมาเอง", () => {
    // ผู้ใช้ส่ง 1.2.3.4 มาเอง แล้ว Railway ต่อ IP จริงไว้ท้ายสุด
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("ปลอมหลายชั้นก็ยังได้ค่าจริง", () => {
    expect(clientIp(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("ไม่มี proxy ซ้อนก็ใช้ค่าเดียวที่มี", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("เว้นวรรคเกินก็ยังอ่านได้", () => {
    expect(clientIp(headers({ "x-forwarded-for": " 1.2.3.4 ,  203.0.113.7 " }))).toBe(
      "203.0.113.7",
    );
  });

  it("ไม่อ่าน cf-connecting-ip เพราะไม่มี Cloudflare คั่นหน้าเว็บนี้", () => {
    // ถ้าอ่าน header นี้ ใครส่งมาเองก็ปลอมได้ทันที
    expect(clientIp(headers({ "cf-connecting-ip": "9.9.9.9" }))).toBe("unknown");
  });

  it("ไม่มี header เลย", () => {
    expect(clientIp(headers({}))).toBe("unknown");
  });
});
