/** ลำดับการแสดงผลค้นหา — ผิดแล้วไม่มีอะไรฟ้อง แต่ผู้ปกครองต้องไถหาของที่เพิ่งประกาศ */
import { describe, expect, it, vi } from "vitest";

// ไม่ต้องมีฐานข้อมูลหรือที่เก็บไฟล์จริงสำหรับเทสการจัดกลุ่ม
vi.mock("./db", () => ({ prisma: {} }));
vi.mock("./r2", () => ({ publicUrl: (key: string) => `https://preview.test/${key}` }));

const { toSearchResult } = await import("./search");

type CertInput = { code: string; name?: string; year: number; round: string; award: string };

function student(...certs: CertInput[]) {
  return toSearchResult({
    id: "s1",
    nameTh: "สมชาย ใจดี",
    nameEn: "SOMCHAI JAIDEE",
    school: "โรงเรียนทดสอบ",
    certificates: certs.map((c, i) => ({
      id: `c${i}`,
      award: c.award,
      level: "PRIMARY 3",
      certNo: `20000${i}`,
      previewKey: `previews/c${i}.webp`,
      exam: { year: c.year, round: c.round, program: { code: c.code, name: c.name ?? c.code } },
    })),
  });
}

describe("การจัดกลุ่มผลค้นหา", () => {
  it("รายการสอบที่มีผลล่าสุดต้องอยู่บนสุด ไม่ใช่เรียงตามตัวอักษร", () => {
    const result = student(
      { code: "HKIMO", year: 2024, round: "FINAL", award: "GOLD" },
      { code: "TIMO", year: 2026, round: "FINAL", award: "SILVER" },
    );
    expect(result.programs.map((p) => p.code)).toEqual(["TIMO", "HKIMO"]);
  });

  it("ปีล่าสุดเท่ากัน เรียงตามรหัสเพื่อให้ลำดับนิ่งทุกครั้งที่โหลด", () => {
    const result = student(
      { code: "WMI", year: 2026, round: "FINAL", award: "GOLD" },
      { code: "AMO", year: 2026, round: "FINAL", award: "GOLD" },
    );
    expect(result.programs.map((p) => p.code)).toEqual(["AMO", "WMI"]);
  });

  it("ในรายการสอบเดียวกัน ปีใหม่อยู่บน และรอบชิงชนะเลิศมาก่อนรอบคัดเลือก", () => {
    const result = student(
      { code: "HKIMO", year: 2025, round: "FINAL", award: "MERIT" },
      { code: "HKIMO", year: 2026, round: "HEAT", award: "SILVER" },
      { code: "HKIMO", year: 2026, round: "FINAL", award: "GOLD" },
    );
    expect(result.programs[0].sessions.map((s) => `${s.year}-${s.round}`)).toEqual([
      "2026-FINAL",
      "2026-HEAT",
      "2025-FINAL",
    ]);
  });

  it("รอบเดียวกันมีหลายใบ อยู่รวมกลุ่มเดียวกัน", () => {
    // ของจริง: ผู้ได้คะแนนเต็มจะได้ใบเหรียญทองมาด้วยอีกใบในรอบเดียวกัน
    const result = student(
      { code: "HKIMO", year: 2026, round: "FINAL", award: "GOLD" },
      { code: "HKIMO", year: 2026, round: "FINAL", award: "PERFECT_SCORE" },
    );
    expect(result.programs[0].sessions).toHaveLength(1);
    expect(result.programs[0].sessions[0].certificates.map((c) => c.award)).toEqual([
      "GOLD",
      "PERFECT_SCORE",
    ]);
  });

  it("ในกลุ่มเดียวกันเรียงใบเหรียญก่อนใบคะแนนเต็ม แม้ข้อมูลเข้ามาสลับลำดับ", () => {
    const result = student(
      { code: "HKIMO", year: 2026, round: "FINAL", award: "PERFECT_SCORE" },
      { code: "HKIMO", year: 2026, round: "FINAL", award: "GOLD" },
    );
    expect(result.programs[0].sessions[0].certificates.map((c) => c.award)).toEqual([
      "GOLD",
      "PERFECT_SCORE",
    ]);
  });

  it("รายการที่มีรางวัลของตัวเองแสดงชื่อจริง ไม่ยุบเป็นเหรียญ", () => {
    const result = student({ code: "BBB", year: 2026, round: "FINAL", award: "1ST_PRIZE" });
    const cert = result.programs[0].sessions[0].certificates[0];
    expect(cert.awardLabel).toBe("1st Prize");
    expect(cert.awardLabelTh).toBe("รางวัลที่ 1");
    expect(cert.badge).toBe("gold");
  });

  it("ใบรางวัลเข้าร่วมและรางวัลพิเศษเรียงหลังรางวัลหลัก", () => {
    const result = student(
      { code: "HKIMO", year: 2026, round: "HEAT", award: "SPECIAL_AWARD" },
      { code: "HKIMO", year: 2026, round: "HEAT", award: "PARTICIPATION" },
      { code: "HKIMO", year: 2026, round: "HEAT", award: "PERFECT_SCORE" },
    );
    expect(result.programs[0].sessions[0].certificates.map((c) => c.award)).toEqual([
      "PARTICIPATION",
      "PERFECT_SCORE",
      "SPECIAL_AWARD",
    ]);
  });

  it("ปีล่าสุดของรายการสอบคิดจากปีที่มากที่สุด ไม่ใช่ใบแรกที่เจอ", () => {
    const result = student(
      { code: "HKIMO", year: 2023, round: "HEAT", award: "MERIT" },
      { code: "HKIMO", year: 2026, round: "FINAL", award: "GOLD" },
    );
    expect(result.programs[0].latestYear).toBe(2026);
  });
});
