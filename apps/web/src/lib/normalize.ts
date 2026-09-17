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

/** แปลงชื่อให้เป็นรูปมาตรฐาน โดยคงลำดับคำไว้ */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";

  // ขั้นที่ 1: NFD -> ลบ combining diacritic -> NFC
  let text = raw.normalize("NFD").replace(COMBINING, "").normalize("NFC");

  // ขั้นที่ 2: อักขระที่ไม่อนุญาต -> ช่องว่าง
  text = text.replace(DISALLOWED, " ");

  // ขั้นที่ 3: ยุบช่องว่าง + ตัดหัวท้าย
  text = text.replace(WHITESPACE, " ").trim();

  // ขั้นที่ 4: พิมพ์ใหญ่ (ไม่กระทบตัวอักษรไทย)
  text = text.toUpperCase();

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
