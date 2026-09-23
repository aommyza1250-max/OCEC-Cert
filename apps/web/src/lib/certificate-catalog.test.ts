import { describe, expect, it } from "vitest";
import {
  awardCatalog,
  awardDisplay,
  folderKey,
  profileKeyFor,
  programManifests,
  resolveAwardFolder,
} from "./certificate-catalog";
import cases from "../../../../shared/certificate-profile-cases.json";

/**
 * เคสทั้งหมดมาจาก shared/certificate-profile-cases.json ไฟล์เดียวกับที่ pytest ฝั่ง worker ใช้
 * ถ้าเทสนี้เขียวแต่ฝั่ง Python แดง (หรือกลับกัน) = สองฝั่งอ่านชื่อโฟลเดอร์ไม่ตรงกันแล้ว
 */
describe("folderKey (ต้องตรงกับ folder_key ฝั่ง Python)", () => {
  for (const c of cases.folderKeys) {
    it(c.why, () => expect(folderKey(c.input)).toBe(c.key));
  }
});

describe("resolveAwardFolder (ต้องตรงกับ AwardCatalog.resolve_folder ฝั่ง Python)", () => {
  for (const c of cases.folders) {
    it(c.why, () => expect(resolveAwardFolder(c.program, c.round, c.folder)).toBe(c.award));
  }
});

describe("profileKeyFor", () => {
  for (const c of cases.profiles) {
    it(`${c.program} ${c.round}`, () => expect(profileKeyFor(c.program, c.round)).toBe(c.profileKey));
  }
});

describe("แคตตาล็อกรางวัล", () => {
  it("ทุกรายการมีรางวัลพิเศษทั้งสองรอบ และรางวัลเข้าร่วมเฉพาะรอบ Heat", () => {
    for (const manifest of programManifests()) {
      const heat = awardCatalog(manifest.program, "HEAT").map((a) => a.code);
      const final = awardCatalog(manifest.program, "FINAL").map((a) => a.code);
      expect(heat).toContain("SPECIAL_AWARD");
      expect(final).toContain("SPECIAL_AWARD");
      expect(heat).toContain("PARTICIPATION");
      expect(final).not.toContain("PARTICIPATION");
    }
  });

  it("ชื่อโฟลเดอร์ไม่ซ้ำกันภายในรายการเดียว", () => {
    for (const manifest of programManifests()) {
      for (const round of ["HEAT", "FINAL"]) {
        const keys = awardCatalog(manifest.program, round).flatMap((a) => a.folders);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it("BBB เก็บชื่อรางวัลจริง ไม่ยุบ 1st Prize เป็น Gold", () => {
    const shown = awardDisplay("BBB", "1ST_PRIZE");
    expect(shown.label).toBe("1st Prize");
    expect(awardCatalog("BBB", "FINAL").map((a) => a.code)).not.toContain("GOLD");
  });

  it("ชื่อที่บันทึกไว้กับเกียรติบัตรมาก่อนชื่อในแคตตาล็อก", () => {
    expect(awardDisplay("HKIMO", "GOLD", { label: "Gold (2025)", labelTh: null }).label).toBe(
      "Gold (2025)",
    );
  });

  it("ข้อมูลชุดเดิมที่ไม่รู้จักรายการ ถอยไปใช้ชื่อมาตรฐาน แล้วค่อยถอยไปใช้รหัส", () => {
    expect(awardDisplay("OLDPROG", "GOLD").labelTh).toBe("เหรียญทอง");
    expect(awardDisplay("OLDPROG", "WEIRD").label).toBe("WEIRD");
  });

  it("รางวัลเรียงรางวัลหลักก่อนรางวัลเสริม", () => {
    const codes = awardCatalog("HKIMO", "HEAT").map((a) => a.code);
    expect(codes.indexOf("MERIT")).toBeLessThan(codes.indexOf("PERFECT_SCORE"));
    expect(codes.indexOf("PARTICIPATION")).toBeLessThan(codes.indexOf("SPECIAL_AWARD"));
  });
});
