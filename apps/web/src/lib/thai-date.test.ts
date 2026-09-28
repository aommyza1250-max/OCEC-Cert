import { describe, expect, it } from "vitest";
import { formatThaiDateTime, formatThaiLongDate } from "./thai-date";

describe("Thai admin dates", () => {
  it("shows Bangkok time for a UTC upload timestamp", () => {
    expect(formatThaiDateTime("2026-09-27T03:11:00Z")).toBe("27 ก.ย. 2569 10:11");
  });

  it("uses the Bangkok calendar date across a UTC midnight boundary", () => {
    const timestamp = "2026-09-27T20:00:00Z";
    expect(formatThaiDateTime(timestamp)).toBe("28 ก.ย. 2569 03:00");
    expect(formatThaiLongDate(timestamp)).toBe("28 กันยายน 2569");
  });
});
