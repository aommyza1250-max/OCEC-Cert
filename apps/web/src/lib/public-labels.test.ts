import { describe, expect, it } from "vitest";
import { publicAwardLabel, publicRoundLabel } from "./public-labels";

describe("public certificate labels", () => {
  it("uses the competition's English round names", () => {
    expect(publicRoundLabel("HEAT")).toBe("Heat Round");
    expect(publicRoundLabel("FINAL")).toBe("Final Round");
  });

  it.each([
    ["1ST_PRIZE", "1ST PRIZE AWARD"],
    ["2ND_PRIZE", "2ND PRIZE AWARD"],
    ["3RD_PRIZE", "3RD PRIZE AWARD"],
    ["MERIT", "MERIT AWARD"],
    ["PARTICIPATION", "PARTICIPATION"],
    ["GOLD", "GOLD AWARD"],
    ["SILVER", "SILVER AWARD"],
    ["BRONZE", "BRONZE AWARD"],
    ["PERFECT_SCORE", "PERFECT SCORE"],
    ["SPECIAL_AWARD", "SPECIAL AWARD"],
  ])("displays %s as %s", (code, expected) => {
    expect(publicAwardLabel(code, "stored English name")).toBe(expected);
  });

  it("keeps an unknown award's saved English name instead of inventing a category", () => {
    expect(publicAwardLabel("CUSTOM", "Certificate of Distinction")).toBe("CERTIFICATE OF DISTINCTION");
    expect(publicAwardLabel("toString", "Another Prize")).toBe("ANOTHER PRIZE");
    expect(publicRoundLabel("toString")).toBe("toString");
  });
});
