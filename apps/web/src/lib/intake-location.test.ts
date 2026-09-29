import { expect, it } from "vitest";
import { intakeLocationUrl, parseIntakeLocation } from "./intake-location";

it("เก็บขั้นและแผงภาพรวมที่เลือกไว้หลังรีเฟรช", () => {
  expect(parseIntakeLocation("3", "missing", 2)).toEqual({ step: 3, panel: "missing" });
  expect(parseIntakeLocation("3", "issues", 2)).toEqual({ step: 3, panel: "issues" });
  expect(parseIntakeLocation("2", "missing", 1)).toEqual({ step: 2, panel: null });
});

it("ค่าจาก URL ที่ไม่ถูกต้องไม่ทำให้หน้าพังและกลับไปขั้นเริ่มต้น", () => {
  expect(parseIntakeLocation("99", "missing", 2)).toEqual({ step: 2, panel: null });
  expect(parseIntakeLocation(undefined, "unknown", 1)).toEqual({ step: 1, panel: null });
});

it("เมื่อเปลี่ยนขั้นจะเขียน URL ให้รีเฟรชแล้วกลับมาถูกที่", () => {
  const current = "https://example.test/admin/batches/abc?foo=bar&step=2#top";
  expect(intakeLocationUrl(current, 3, "missing"))
    .toBe("/admin/batches/abc?foo=bar&step=3&panel=missing#top");
  expect(intakeLocationUrl("https://example.test/admin/batches/abc?step=3&panel=issues", 1))
    .toBe("/admin/batches/abc?step=1");
});
