import { describe, expect, it } from "vitest";
import { adminPageWindow } from "./admin-pagination";

describe("admin participant pagination", () => {
  it("shows 100 per page and links 1–10 for a 1,166-person batch", () => {
    expect(adminPageWindow(1166, undefined)).toEqual({
      page: 1, lastPage: 12, firstLink: 1,
      pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], from: 1, to: 100,
    });
    expect(adminPageWindow(1166, "11")).toMatchObject({ page: 11, pageNumbers: [11, 12], from: 1001, to: 1100 });
    expect(adminPageWindow(1166, "12")).toMatchObject({ page: 12, from: 1101, to: 1166 });
  });

  it("clamps invalid pages and handles an empty result", () => {
    expect(adminPageWindow(1166, "999").page).toBe(12);
    expect(adminPageWindow(1166, "invalid").page).toBe(1);
    expect(adminPageWindow(0, undefined)).toMatchObject({ page: 1, lastPage: 1, from: 0, to: 0 });
  });
});
