/**
 * กติกาการแก้ข้อมูลผู้เข้าสอบในรายชื่อ (roster entry) — ใช้ร่วมกันทุก route ที่แก้ผู้เข้าสอบ
 *
 * ข้อมูลการสอบ (เลข รูปแบบการสอบ ระดับชั้น) เป็นของรอบนำเข้านี้เท่านั้น
 * ส่วนชื่อที่ผู้ปกครองค้นหาอยู่ที่ตัวคน (Student) ซึ่งใช้ร่วมกันข้ามปี
 * การแก้ชื่อจึงต้องระวังว่าจะไปเปลี่ยนชื่อบนเกียรติบัตรปีก่อน ๆ ของคนนั้นด้วยหรือไม่
 */
import { Prisma, type ExamMode, type RosterEntry } from "@prisma/client";
import type { GuardedBatch, Tx } from "./batch-guard";
import { HttpError } from "./http";
import { nameSortKey, normalizeName, normalizeSchool } from "./normalize";

export const STALE_MESSAGE = "ข้อมูลนี้ถูกแก้จากที่อื่นไปแล้ว (อาจเปิดไว้หลายแท็บ) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง";

/** ช่องที่คำนวณจากชื่อและโรงเรียน — ห้ามเขียนค่าดิบลงคอลัมน์ normalized */
export function derivedFields(input: { nameEn?: string | null; nameTh?: string | null; school?: string | null }) {
  return {
    nameEnNormalized: normalizeName(input.nameEn) || null,
    nameThNormalized: normalizeName(input.nameTh) || null,
    nameEnSortKey: nameSortKey(input.nameEn) || null,
    schoolNormalized: normalizeSchool(input.school) || null,
  };
}

export function requireUsableName(nameEn?: string | null, nameTh?: string | null) {
  if (!normalizeName(nameEn) && !normalizeName(nameTh)) {
    throw new HttpError(400, "ต้องมีชื่อผู้เข้าสอบอย่างน้อยหนึ่งภาษา");
  }
}

export function normalizeCandidateNo(raw: string): string {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) throw new HttpError(400, "เลขผู้เข้าสอบต้องเป็นตัวเลขล้วน");
  return value;
}

export async function assertCandidateNoFree(tx: Tx, batchId: string, candidateNo: string, exceptId?: string) {
  const taken = await tx.rosterEntry.findFirst({
    where: { batchId, candidateNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { nameEn: true, nameTh: true },
  });
  if (taken) {
    throw new HttpError(
      409,
      `เลข ${candidateNo} เป็นของ ${taken.nameEn ?? taken.nameTh ?? "ผู้เข้าสอบคนอื่น"} อยู่แล้ว (เลขต้องไม่ซ้ำกันทั้ง online และ onsite)`,
    );
  }
}

/** โหลดผู้เข้าสอบภายใต้ล็อกของรอบนำเข้า พร้อมตรวจว่าเป็นของรอบนี้ และยังไม่ถูกแก้จากที่อื่น */
export async function loadEntry(tx: Tx, batch: GuardedBatch, entryId: string, version?: number) {
  const entry = await tx.rosterEntry.findFirst({ where: { id: entryId, batchId: batch.id } });
  if (!entry) throw new HttpError(404, "ไม่พบผู้เข้าสอบคนนี้ในรายชื่อ — อาจถูกลบไปแล้ว");
  if (version !== undefined && entry.version !== version) {
    throw new HttpError(409, STALE_MESSAGE, { code: "STALE" });
  }
  return entry;
}

/** เพิ่มเวอร์ชันพร้อมแก้ — ถ้ามีคนแก้ตัดหน้าระหว่างนั้น จะไม่มีแถวไหนถูกแก้ */
export async function updateEntry(
  tx: Tx,
  entry: RosterEntry,
  data: Prisma.RosterEntryUncheckedUpdateManyInput,
) {
  const { count } = await tx.rosterEntry.updateMany({
    where: { id: entry.id, version: entry.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) throw new HttpError(409, STALE_MESSAGE, { code: "STALE" });
}

/** จำนวนเกียรติบัตรของตัวคนนี้ในรายการสอบอื่น — แก้ชื่อตัวคนแล้วใบพวกนี้เปลี่ยนชื่อตามทั้งหมด */
export async function historyOutsideBatch(tx: Tx, studentId: string, batchId: string) {
  return tx.certificate.count({ where: { studentId, batchId: { not: batchId } } });
}

/** สร้างตัวคนใหม่จากข้อมูลในรายชื่อ แล้วย้ายใบของรอบนี้ไปอยู่กับคนใหม่ */
export async function separateStudent(tx: Tx, entry: RosterEntry) {
  const student = await tx.student.create({
    data: {
      nameEn: entry.nameEn,
      nameTh: entry.nameTh,
      school: entry.school,
      ...derivedFields(entry),
    },
  });
  await tx.certificate.updateMany({ where: { rosterEntryId: entry.id }, data: { studentId: student.id } });
  await tx.stagingPage.updateMany({
    where: { rosterEntryId: entry.id, matchStatus: "MATCHED" },
    data: { matchedStudentId: student.id },
  });
  return student;
}

/** คืนหน้าที่ผูกกับผู้เข้าสอบคนนี้กลับไปรอจับคู่ใหม่ (ก่อนลบคนนั้นออกจากรายชื่อ) */
export async function releasePages(tx: Tx, entryId: string) {
  await tx.stagingPage.updateMany({
    where: {
      rosterEntryId: entryId,
      matchStatus: { in: ["MATCHED", "NAME_MISMATCH", "MODE_MISMATCH", "AMBIGUOUS", "DUPLICATE_NAME"] },
    },
    data: { matchStatus: "UNMATCHED", matchedStudentId: null },
  });
  await tx.stagingPage.updateMany({
    where: { rosterEntryId: entryId },
    data: { rosterEntryId: null, manualMatch: Prisma.DbNull, matchedManually: false },
  });
}

export type EntrySnapshot = {
  candidateNo: string;
  nameEn: string | null;
  nameTh: string | null;
  examMode: ExamMode;
  school: string | null;
  level: string | null;
  source: string;
};

export function snapshot(entry: RosterEntry): EntrySnapshot {
  return {
    candidateNo: entry.candidateNo,
    nameEn: entry.nameEn,
    nameTh: entry.nameTh,
    examMode: entry.examMode,
    school: entry.school,
    level: entry.level,
    source: entry.source,
  };
}
