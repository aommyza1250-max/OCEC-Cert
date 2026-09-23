import { describe, expect, it } from "vitest";
import {
  decidePublish,
  needsPolicyDecision,
  summarize,
  type HoldReason,
  type Mode,
  type Participant,
} from "./publish-rules";

const SUPPLEMENTAL = new Set(["PERFECT_SCORE", "SPECIAL_AWARD"]);

const person = (
  entryId: string,
  awards: string[],
  options: { mode?: Mode; issues?: HoldReason[] } = {},
): Participant => ({
  entryId,
  mode: options.mode ?? "ONLINE",
  issues: options.issues ?? [],
  certificates: awards.map((award, i) => ({
    id: `${entryId}-${i}`,
    award,
    kind: SUPPLEMENTAL.has(award) ? "SUPPLEMENTAL" : "PRIMARY",
  })),
});

describe("decidePublish", () => {
  it("คนที่มีใบรางวัลหลักเผยแพร่เสมอ ไม่ว่าตั้งค่ารอบไว้ยังไง", () => {
    const people = [person("a", ["GOLD"]), person("b", ["1ST_PRIZE"]), person("c", ["PARTICIPATION"])];
    for (const policy of ["ALL", "MEDAL_ONLY", "UNDECIDED"] as const) {
      expect(decidePublish(people, policy).publish).toEqual(["a-0", "b-0", "c-0"]);
    }
  });

  it("ตั้งว่าส่งทั้งสองใบ ก็เผยแพร่ทั้งสองใบ", () => {
    const d = decidePublish([person("a", ["GOLD", "PERFECT_SCORE"])], "ALL");
    expect(d.publish).toEqual(["a-0", "a-1"]);
    expect(d.hiddenByPolicy).toEqual([]);
  });

  it("ตั้งว่าส่งแค่ใบรางวัลหลัก ให้ซ่อนใบรางวัลเสริม", () => {
    const d = decidePublish([person("a", ["GOLD", "PERFECT_SCORE", "SPECIAL_AWARD"])], "MEDAL_ONLY");
    expect(d.publish).toEqual(["a-0"]);
    expect(d.hiddenByPolicy).toEqual(["a-1", "a-2"]);
  });

  it("มีแต่ใบรางวัลเสริม ต้องกันไว้ทั้งคน", () => {
    // ใบรางวัลหลักน่าจะตกหล่น — ปล่อยใบเสริมออกไปก่อนจะทำให้เข้าใจผิดว่านั่นคือรางวัลที่ได้
    const d = decidePublish([person("a", ["PERFECT_SCORE"])], "ALL");
    expect(d.publish).toEqual([]);
    expect(d.held).toEqual(["a-0"]);
    expect(d.heldParticipants).toEqual([{ entryId: "a", mode: "ONLINE", reason: "MISSING_PRIMARY" }]);
  });

  it("ยังไม่มีไฟล์เลย ถูกนับเป็นคนที่ค้างไว้", () => {
    const d = decidePublish([person("a", [], { mode: "ONSITE" })], "ALL");
    expect(d.heldParticipants).toEqual([{ entryId: "a", mode: "ONSITE", reason: "MISSING_FILE" }]);
  });

  it("มีหน้าที่ยังรอตัดสิน ต้องกันไว้ทั้งคน แม้จะมีใบที่ผ่านแล้ว", () => {
    const d = decidePublish([person("a", ["GOLD"], { issues: ["MODE_MISMATCH"] })], "ALL");
    expect(d.publish).toEqual([]);
    expect(d.held).toEqual(["a-0"]);
    expect(d.heldParticipants[0].reason).toBe("MODE_MISMATCH");
  });

  it("ติดหลายเรื่อง แสดงเรื่องที่ต้องแก้ก่อน", () => {
    const d = decidePublish([person("a", [], { issues: ["DUPLICATE_REVIEW", "NAME_MISMATCH"] })], "ALL");
    expect(d.heldParticipants[0].reason).toBe("NAME_MISMATCH");
  });

  it("คนอื่นในรอบเดียวกันไม่ถูกกระทบ", () => {
    const d = decidePublish(
      [
        person("a", ["PERFECT_SCORE"]),
        person("b", ["GOLD"]),
        person("c", ["GOLD", "PERFECT_SCORE"]),
        person("d", ["SILVER"], { issues: ["AMBIGUOUS"] }),
      ],
      "MEDAL_ONLY",
    );
    expect(d.held).toEqual(["a-0", "d-0"]);
    expect(d.publish).toEqual(["b-0", "c-0"]);
    expect(d.hiddenByPolicy).toEqual(["c-1"]);
  });
});

describe("summarize", () => {
  it("นับคนและใบที่จะเผยแพร่ กับคนที่ค้าง แยกตามเหตุผลและรูปแบบการสอบ", () => {
    const d = decidePublish(
      [
        person("a", ["GOLD"]),
        person("b", ["GOLD", "PERFECT_SCORE"], { mode: "ONSITE" }),
        person("c", [], { mode: "ONSITE" }),
        person("d", []),
        person("e", ["GOLD"], { issues: ["MODE_MISMATCH"], mode: "ONSITE" }),
      ],
      "ALL",
    );
    const s = summarize(d);
    expect(s.toPublish).toEqual({ participants: 2, certificates: 3, byMode: { ONLINE: 1, ONSITE: 1 } });
    expect(s.held.participants).toBe(3);
    expect(s.held.certificates).toBe(1);
    expect(s.held.byReason.map((r) => [r.reason, r.ONLINE, r.ONSITE])).toEqual([
      ["MODE_MISMATCH", 0, 1],
      ["MISSING_FILE", 1, 1],
    ]);
  });
});

describe("needsPolicyDecision", () => {
  it("ต้องเลือกเมื่อมีคนถือทั้งใบรางวัลหลักและรางวัลเสริม", () => {
    expect(needsPolicyDecision([person("a", ["GOLD", "PERFECT_SCORE"])])).toBe(true);
    expect(needsPolicyDecision([person("a", ["1ST_PRIZE", "SPECIAL_AWARD"])])).toBe(true);
  });

  it("ไม่ต้องเลือกถ้าไม่มีใครได้รางวัลเสริม", () => {
    expect(needsPolicyDecision([person("a", ["GOLD"]), person("b", ["SILVER"])])).toBe(false);
  });

  it("ไม่ต้องเลือกถ้ามีแต่คนที่ถูกกันไว้อยู่แล้ว", () => {
    expect(needsPolicyDecision([person("a", ["PERFECT_SCORE"])])).toBe(false);
    expect(needsPolicyDecision([person("a", ["GOLD", "PERFECT_SCORE"], { issues: ["AMBIGUOUS"] })])).toBe(false);
  });
});

describe("batchConfirmPhrase", () => {
  it("สร้างข้อความยืนยันแบบเดียวกับที่แสดงบนหน้าจอ", async () => {
    const { batchConfirmPhrase } = await import("./batch-delete");
    expect(batchConfirmPhrase("HKIMO", "FINAL", 2026)).toBe("HKIMO FINAL 2026");
    // รหัสรายการสอบที่พิมพ์เล็กมาก็ต้องได้ข้อความเดียวกัน ไม่งั้นแอดมินพิมพ์ตามจอแล้วโดนปฏิเสธ
    expect(batchConfirmPhrase("timo", "HEAT", 2025)).toBe("TIMO HEAT 2025");
  });
});
