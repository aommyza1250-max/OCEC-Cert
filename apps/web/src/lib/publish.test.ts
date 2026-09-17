import { describe, expect, it } from "vitest";
import { decidePublish, needsPolicyDecision } from "./publish";

const person = (studentId: string, ...awards: string[]) => ({
  studentId,
  certificates: awards.map((award, i) => ({ id: `${studentId}-${i}`, award })),
});

describe("decidePublish", () => {
  it("คนที่มีใบเดียวเผยแพร่เสมอ ไม่ว่าตั้งค่ารอบไว้ยังไง", () => {
    const people = [person("a", "GOLD"), person("b", "MERIT")];
    for (const policy of ["ALL", "MEDAL_ONLY", "UNDECIDED"] as const) {
      expect(decidePublish(people, policy).publish).toEqual(["a-0", "b-0"]);
    }
  });

  it("ตั้งว่าส่งทั้งสองใบ ก็เผยแพร่ทั้งสองใบ", () => {
    const d = decidePublish([person("a", "GOLD", "PERFECT_SCORE")], "ALL");
    expect(d.publish).toEqual(["a-0", "a-1"]);
    expect(d.hiddenByPolicy).toEqual([]);
  });

  it("ตั้งว่าส่งแค่ใบเหรียญ ให้ซ่อนเฉพาะใบ Perfect Score", () => {
    const d = decidePublish([person("a", "GOLD", "PERFECT_SCORE")], "MEDAL_ONLY");
    expect(d.publish).toEqual(["a-0"]);
    expect(d.hiddenByPolicy).toEqual(["a-1"]);
    expect(d.held).toEqual([]);
  });

  it("มี Perfect Score แต่ไม่มีใบเหรียญ ต้องกันไว้ทั้งคน", () => {
    // เป็นไปไม่ได้ตามกติกาการให้รางวัล = ไฟล์ใบเหรียญตกหล่น
    // ต้องกันไว้ ไม่ใช่ปล่อยใบ Perfect Score ออกไปแทนใบที่ผู้ปกครองควรได้จริง
    const d = decidePublish([person("a", "PERFECT_SCORE")], "MEDAL_ONLY");
    expect(d.publish).toEqual([]);
    expect(d.held).toEqual(["a-0"]);
    expect(d.heldStudents[0].studentId).toBe("a");
  });

  it("กันไว้ทั้งคนแม้จะตั้งว่าส่งทั้งสองใบ", () => {
    const d = decidePublish([person("a", "PERFECT_SCORE")], "ALL");
    expect(d.held).toEqual(["a-0"]);
  });

  it("คนอื่นในรอบเดียวกันไม่ถูกกระทบ", () => {
    const d = decidePublish(
      [person("a", "PERFECT_SCORE"), person("b", "GOLD"), person("c", "GOLD", "PERFECT_SCORE")],
      "MEDAL_ONLY",
    );
    expect(d.held).toEqual(["a-0"]);
    expect(d.publish).toEqual(["b-0", "c-0"]);
    expect(d.hiddenByPolicy).toEqual(["c-1"]);
  });
});

describe("needsPolicyDecision", () => {
  it("ต้องเลือกเมื่อมีคนถือทั้งใบเหรียญและ Perfect Score", () => {
    expect(needsPolicyDecision([person("a", "GOLD", "PERFECT_SCORE")])).toBe(true);
  });

  it("ไม่ต้องเลือกถ้าไม่มีใครได้ Perfect Score", () => {
    expect(needsPolicyDecision([person("a", "GOLD"), person("b", "SILVER")])).toBe(false);
  });

  it("ไม่ต้องเลือกถ้ามีแต่คนที่ถูกกันไว้อยู่แล้ว", () => {
    // คนที่มี Perfect Score ใบเดียวถูกกันไว้ทั้งคน ตัวเลือกของรอบไม่มีผลกับเขา
    expect(needsPolicyDecision([person("a", "PERFECT_SCORE")])).toBe(false);
  });
});
