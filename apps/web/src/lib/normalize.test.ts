import { describe, expect, it } from "vitest";
import { nameSortKey, normalizeName, normalizeSchool } from "./normalize";
import cases from "../../../../shared/normalize-cases.json";

/**
 * เคสทั้งหมดมาจาก shared/normalize-cases.json ไฟล์เดียวกับที่ pytest ฝั่ง worker ใช้
 * ถ้าเทสนี้เขียวแต่ฝั่ง Python แดง (หรือกลับกัน) = สองฝั่ง normalize ไม่ตรงกันแล้ว
 */
describe("normalizeName / nameSortKey (ต้องตรงกับ apps/worker/app/normalize.py)", () => {
  for (const c of cases.cases) {
    it(`${c.why}: ${JSON.stringify(c.input)}`, () => {
      expect(normalizeName(c.input)).toBe(c.normalized);
      expect(nameSortKey(c.input)).toBe(c.sortKey);
    });
  }
});

describe("normalizeSchool (ต้องตรงกับ apps/worker/app/normalize.py)", () => {
  for (const c of cases.schoolCases) {
    it(`${c.why}: ${JSON.stringify(c.input)}`, () => {
      expect(normalizeSchool(c.input)).toBe(c.normalized);
    });
  }
});
