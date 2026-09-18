import { describe, expect, it } from "vitest";
import { clientIp, readLimit } from "./rate-limit";

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

describe("readLimit", () => {
  const withEnv = (value: string | undefined, run: () => void) => {
    const previous = process.env.TEST_LIMIT;
    if (value === undefined) delete process.env.TEST_LIMIT;
    else process.env.TEST_LIMIT = value;
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env.TEST_LIMIT;
      else process.env.TEST_LIMIT = previous;
    }
  };

  it("ไม่ได้ตั้งค่าไว้ ใช้ค่าปริยาย", () => {
    withEnv(undefined, () => expect(readLimit("TEST_LIMIT", 300)).toBe(300));
  });

  it("ตั้งเป็นค่าว่าง ต้องใช้ค่าปริยาย ไม่ใช่ปิดการจำกัด", () => {
    // ช่องค่าว่างบนหน้า Railway กดพลาดง่าย ถ้านับเป็น 0 เท่ากับปิดทิ้งเงียบ ๆ
    withEnv("", () => expect(readLimit("TEST_LIMIT", 300)).toBe(300));
    withEnv("   ", () => expect(readLimit("TEST_LIMIT", 300)).toBe(300));
  });

  it("ตั้งเป็น 0 คือตั้งใจปิดการจำกัด", () => {
    withEnv("0", () => expect(readLimit("TEST_LIMIT", 300)).toBe(0));
  });

  it("ตั้งค่าเป็นตัวเลขปกติ", () => {
    withEnv("50", () => expect(readLimit("TEST_LIMIT", 300)).toBe(50));
  });

  it("ตั้งค่าที่ไม่ใช่ตัวเลข ใช้ค่าปริยาย", () => {
    withEnv("มั่ว", () => expect(readLimit("TEST_LIMIT", 300)).toBe(300));
    withEnv("-5", () => expect(readLimit("TEST_LIMIT", 300)).toBe(300));
  });
});
