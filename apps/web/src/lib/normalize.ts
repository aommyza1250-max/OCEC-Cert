/**
 * กฎ normalize ชื่อ (ฝั่ง TypeScript)
 *
 * ⚠️ ไฟล์นี้ต้องให้ผลลัพธ์ตรงกับ apps/worker/app/normalize.py ทุกกรณี
 * สเปก: docs/name-normalization.md
 * เทส: src/lib/normalize.test.ts (อ่านเคสจาก shared/normalize-cases.json)
 *
 * ถ้าแก้ไฟล์นี้ ต้องแก้ฝั่ง Python ด้วยเสมอ ไม่งั้นการ match จะพังแบบเงียบ ๆ
 */

/** ตัดแบบ "ขึ้นต้นด้วย" ไม่ต้องมีช่องว่างคั่น เพราะภาษาไทยเขียนติดกัน
 *  ลำดับสำคัญมาก: ยาวก่อนสั้น ไม่งั้น "นางสาว" จะโดน "นาง" ตัดก่อน */
const THAI_PREFIXES = [
  "เด็กหญิง",
  "เด็กชาย",
  "ว่าที่ร้อยตรี",
  "นางสาว",
  "นาง",
  "นาย",
  "ด ช",
  "ด ญ",
  "น ส",
  "ดช",
  "ดญ",
  "นส",
] as const;

/** ตัดแบบ "เป็นคำแรก" ต้องมีช่องว่างตามหลัง
 *  ไม่งั้นชื่อจริงอย่าง MRINAL จะถูกตัดเหลือ INAL */
const LATIN_PREFIXES = ["MASTER", "MISS", "PROF", "MRS", "MR", "MS", "DR"] as const;

const COMBINING = /[̀-ͯ]/g;
/** เก็บเฉพาะ: ละติน, ตัวเลข, อักขระไทย — ที่เหลือกลายเป็นช่องว่าง */
const DISALLOWED = /[^A-Za-z0-9฀-๿]+/g;
const WHITESPACE = /\s+/g;

const MAX_PREFIX_PASSES = 3;

/**
 * ขั้นตอนทำความสะอาดพื้นฐาน (ขั้นที่ 1-4) ที่ทั้งชื่อคน ชื่อโรงเรียน และรางวัลใช้ร่วมกัน
 *
 * 1. NFD -> ลบ combining diacritic -> NFC
 * 2. อักขระที่ไม่อนุญาต -> ช่องว่าง
 * 3. ยุบช่องว่าง + ตัดหัวท้าย
 * 4. พิมพ์ใหญ่ (ไม่กระทบตัวอักษรไทย)
 */
export function basicClean(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(COMBINING, "")
    .normalize("NFC")
    .replace(DISALLOWED, " ")
    .replace(WHITESPACE, " ")
    .trim()
    .toUpperCase();
}

/** แปลงชื่อให้เป็นรูปมาตรฐาน โดยคงลำดับคำไว้ */
export function normalizeName(raw: string | null | undefined): string {
  let text = basicClean(raw);
  if (!text) return "";

  // ขั้นที่ 5: ตัดคำนำหน้า วนจนไม่มีอะไรถูกตัด
  for (let i = 0; i < MAX_PREFIX_PASSES; i++) {
    const stripped = stripOnePrefix(text);
    if (stripped === text) break;
    text = stripped;
  }

  // ขั้นที่ 6: ยุบช่องว่าง + ตัดหัวท้าย อีกรอบ
  return text.replace(WHITESPACE, " ").trim();
}

function stripOnePrefix(text: string): string {
  for (const prefix of THAI_PREFIXES) {
    if (text.startsWith(prefix)) return text.slice(prefix.length).replace(/^\s+/, "");
  }
  for (const prefix of LATIN_PREFIXES) {
    if (text.startsWith(prefix + " ")) return text.slice(prefix.length + 1).replace(/^\s+/, "");
  }
  return text;
}

/** คำที่ไม่ได้ช่วยระบุว่าเป็นรางวัลอะไร ต่างแหล่งเติมมาไม่เหมือนกัน
 *  Excel เขียน "GOLD AWARD" / "PERFECT SCORER" ส่วนโฟลเดอร์เขียนแค่ "Gold" */
const AWARD_NOISE = new Set(["AWARD", "AWARDS", "SCORER", "SCORERS", "MEDAL", "PRIZE"]);

/** ค่ามาตรฐาน 5 ค่าที่ระบบใช้ทั้งในชื่อไฟล์และฐานข้อมูล */
const AWARD_CANONICAL: Record<string, string> = {
  GOLD: "GOLD",
  "1ST": "GOLD",
  SILVER: "SILVER",
  "2ND": "SILVER",
  BRONZE: "BRONZE",
  "3RD": "BRONZE",
  MERIT: "MERIT",
  PERFECT: "PERFECT_SCORE",
  PERFECT_SCORE: "PERFECT_SCORE",
  PARTICIPATION: "PARTICIPATION",
};

/** ชื่อรางวัลภาษาไทย — เรียงจากเจาะจงไปกว้าง ("ทองแดง" ต้องมาก่อน "ทอง") */
const AWARD_THAI: [string, string][] = [
  ["ทองแดง", "BRONZE"],
  ["ทอง", "GOLD"],
  ["เงิน", "SILVER"],
  ["ชมเชย", "MERIT"],
  ["คะแนนเต็ม", "PERFECT_SCORE"],
  ["เข้าร่วม", "PARTICIPATION"],
];

/**
 * แปลงชื่อรางวัลให้เป็นค่ามาตรฐาน 1 ใน 5 ค่า
 *
 * รางวัลมาจาก 3 แหล่งที่สะกดไม่เหมือนกันเลย:
 *   ชื่อโฟลเดอร์ใน ZIP    "Gold", "Perfect_Score"
 *   ข้อความบนเกียรติบัตร  "Gold Award"
 *   คอลัมน์ AWARD ใน Excel "GOLD AWARD", "PERFECT SCORER"
 *
 * รางวัลที่ไม่รู้จักคืนค่าว่าง ไม่ใช่เดา — เพราะรางวัลผิดจะไปโผล่บนหน้าเว็บของเด็ก
 */
export function normalizeAward(raw: string | null | undefined): string {
  const text = basicClean(raw);
  if (!text) return "";

  for (const [thai, canonical] of AWARD_THAI) {
    if (text.includes(thai)) return canonical;
  }

  // "3rdPrize" เขียนติดกันไม่มีเว้นวรรค ต้องแยกเลขลำดับออกจากคำก่อน
  const key = text
    .replace(/\b(\d+(?:ST|ND|RD|TH))(?=[A-Z])/g, "$1 ")
    .split(" ")
    .filter((t) => t && !AWARD_NOISE.has(t))
    .join("_");
  return AWARD_CANONICAL[key] ?? "";
}

/** ชื่อรางวัลที่แสดงให้คนอ่าน */
export const AWARD_LABELS: Record<string, string> = {
  GOLD: "เหรียญทอง",
  SILVER: "เหรียญเงิน",
  BRONZE: "เหรียญทองแดง",
  MERIT: "ชมเชย",
  PERFECT_SCORE: "คะแนนเต็ม",
};

/** ชื่อรอบที่แสดงให้คนอ่าน — ผู้ปกครองไม่รู้ว่า HEAT/FINAL คืออะไร */
export const ROUND_LABELS: Record<string, string> = {
  HEAT: "รอบคัดเลือก",
  FINAL: "รอบชิงชนะเลิศ",
};

/** ลำดับการแสดงรอบ: เลขน้อยอยู่ก่อน
 *  รอบชิงชนะเลิศมาก่อนรอบคัดเลือก เพราะเป็นใบที่ผู้ปกครองตั้งใจมาหามากกว่า */
const ROUND_ORDER: Record<string, number> = { FINAL: 0, HEAT: 1 };

export function roundRank(round: string): number {
  return ROUND_ORDER[round] ?? 9;
}

/** ลำดับการแสดงรางวัลในกลุ่มเดียวกัน: ใบเหรียญก่อน แล้วค่อยใบพิเศษ
 *  ของจริงคนหนึ่งได้หลายใบในรอบเดียวเมื่อได้เหรียญทองแล้วทำคะแนนเต็ม */
const AWARD_ORDER: Record<string, number> = {
  GOLD: 0,
  SILVER: 1,
  BRONZE: 2,
  MERIT: 3,
  PERFECT_SCORE: 4,
};

export function awardRank(award: string): number {
  return AWARD_ORDER[award] ?? 9;
}

/** คำนำหน้าชื่อโรงเรียนที่ไม่ได้ช่วยแยกความต่าง — เขียนบ้างไม่เขียนบ้างในไฟล์เดียวกัน
 *  ภาษาไทยตัดแบบ "ขึ้นต้นด้วย" ได้เลยเพราะเขียนติดกัน */
const THAI_SCHOOL_PREFIXES = ["โรงเรียน", "รร"] as const;
/** ภาษาอังกฤษต้องมีช่องว่างตามหลัง ไม่งั้นชื่อจริงอย่าง THEPSIRIN จะถูกตัดเหลือ PSIRIN */
const LATIN_SCHOOL_PREFIXES = ["SCHOOL", "THE"] as const;

/**
 * แปลงชื่อโรงเรียนให้เทียบกันได้
 *
 * ใช้แยกคนที่ชื่อพ้องกัน — ชื่ออย่างเดียวไม่พอที่จะบอกว่าเป็นคนเดียวกัน
 *
 * ต่างจาก normalizeName ตรงที่ **ตัดช่องว่างทิ้งทั้งหมด** เพราะชื่อโรงเรียนไทย
 * เขียนเว้นวรรคไม่เหมือนกันในแต่ละไฟล์ ("สวนกุหลาบวิทยาลัย" กับ "สวนกุหลาบ วิทยาลัย")
 * แต่หมายถึงที่เดียวกัน ส่วนชื่อคนต้องคงช่องว่างไว้เพราะแยกชื่อกับนามสกุล
 */
export function normalizeSchool(raw: string | null | undefined): string {
  let text = normalizeName(raw);
  if (!text) return "";

  const thai = THAI_SCHOOL_PREFIXES.find((p) => text.startsWith(p));
  if (thai) {
    text = text.slice(thai.length).replace(/^\s+/, "");
  } else {
    const latin = LATIN_SCHOOL_PREFIXES.find((p) => text.startsWith(p + " "));
    if (latin) text = text.slice(latin.length + 1).replace(/^\s+/, "");
  }

  return text.replace(WHITESPACE, "");
}

/**
 * normalize แล้วเรียงคำตามตัวอักษร
 *
 * ใช้ช่วยจับคู่กรณี Excel เขียน 'นามสกุล ชื่อ' แต่ PDF เขียน 'ชื่อ นามสกุล'
 * ห้ามใช้ยืนยันตัวตนเดี่ยว ๆ เพราะสลับคำแล้วอาจเป็นคนละคนจริง
 */
export function nameSortKey(raw: string | null | undefined): string {
  const normalized = normalizeName(raw);
  if (!normalized) return "";
  return normalized.split(" ").sort().join(" ");
}
