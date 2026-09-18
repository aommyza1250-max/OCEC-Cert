import { describe, expect, it } from "vitest";
import { clientIp } from "./rate-limit";

const headers = (values: Record<string, string>) => new Headers(values);

/** header ชุดเดียวกับที่ Railway ส่งมาถึงแอปจริง (เก็บมาจาก production) */
const RAILWAY = {
  "x-forwarded-for": "27.130.180.201, 152.233.68.97",
  "x-real-ip": "27.130.180.201",
  "x-railway-edge": "sin1",
};

describe("clientIp", () => {
  it("ใช้ x-real-ip ที่ Railway ใส่ให้ ไม่ใช่ค่าใน x-forwarded-for", () => {
    expect(clientIp(headers(RAILWAY))).toBe("27.130.180.201");
  });

  it("ผู้ใช้ปลอม x-forwarded-for มาเอง ก็ยังนับตาม IP จริง", () => {
    // เคสที่เคยทำให้การจำกัดจำนวนครั้งใช้ไม่ได้จริงมาแล้วสองรอบ
    expect(
      clientIp(
        headers({
          ...RAILWAY,
          "x-forwarded-for": "9.9.9.9, 27.130.180.201, 152.233.68.97",
        }),
      ),
    ).toBe("27.130.180.201");
  });

  it("ปลอมหลายชั้นแค่ไหนก็ไม่มีผล ตราบใดที่ x-real-ip มา", () => {
    expect(
      clientIp(headers({ ...RAILWAY, "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("27.130.180.201");
  });

  it("เว้นวรรคเกินก็ยังอ่านได้", () => {
    expect(clientIp(headers({ "x-real-ip": "  203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("ไม่มี x-real-ip ใช้ตัวซ้ายสุดของ x-forwarded-for เป็นทางสำรอง", () => {
    // เกิดตอนรันนอก Railway เช่นในเครื่องตอน dev
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("ไม่อ่าน cf-connecting-ip เพราะไม่มี Cloudflare คั่นหน้าเว็บนี้", () => {
    // ถ้าอ่าน header นี้ ใครส่งมาเองก็ปลอมได้ทันที
    expect(clientIp(headers({ "cf-connecting-ip": "9.9.9.9" }))).toBe("unknown");
  });

  it("ไม่มี header เลย", () => {
    expect(clientIp(headers({}))).toBe("unknown");
  });
});
