/**
 * ประตูเดียวของการแก้ข้อมูลในรอบนำเข้า — ทุก API ที่อัปโหลด แก้ไข หรือตัดสิน ต้องผ่านที่นี่
 *
 * กติกาที่บังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม:
 *   - รอบที่เผยแพร่อยู่ ห้ามอัปโหลดหรือแก้อะไรทั้งนั้น ต้องยกเลิกการเผยแพร่ก่อน
 *   - รอบนำเข้าเดียวกันแก้ได้ทีละอย่าง: ล็อกแถว batch ไว้ตลอดทรานแซกชัน
 *     และถ้ามีงานนำเข้า/จับคู่ค้างอยู่ ห้ามแก้ (ผลของงานนั้นยังเปลี่ยนได้อีก)
 *     worker ล็อกแถวเดียวกันตอนหยิบงาน งานจึงเริ่มกลางการแก้ไขไม่ได้
 *   - รอบจากระบบเดิม (ไม่มีโปรไฟล์) นำเข้าต่อด้วยขั้นตอนใหม่ไม่ได้ ต้องนำเข้าใหม่ทั้งรอบ
 */
import type { JobType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { wakeWorker } from "./worker";

export type Tx = Prisma.TransactionClient;

export type GuardedBatch = {
  id: string;
  status: string;
  profileKey: string | null;
  activeRosterImportId: string | null;
  programCode: string;
  round: "HEAT" | "FINAL";
  year: number;
  label: string;
};

/** งานที่แก้ข้อมูลของรอบนำเข้า — ระหว่างที่ค้างอยู่ ห้ามแก้ไขจากหน้าเว็บ */
export const INTAKE_JOBS: JobType[] = ["SPLIT", "MATCH", "ROSTER_VALIDATE", "ROSTER_ACTIVATE"];

export const PUBLISHED_MESSAGE =
  "รอบนี้เผยแพร่อยู่ — ต้องกด \"ยกเลิกการเผยแพร่\" ก่อน จึงจะอัปโหลดหรือแก้ไขได้";
export const LEGACY_MESSAGE =
  "รอบนี้นำเข้าด้วยระบบเดิม แก้ไขด้วยขั้นตอนใหม่ไม่ได้ — ต้องลบรอบนี้แล้วนำเข้าใหม่ตามขั้นตอนใหม่";
export const BUSY_MESSAGE =
  "ระบบกำลังประมวลผลรอบนี้อยู่ กรุณารอให้เสร็จก่อน แล้วโหลดหน้าใหม่";

type Options = {
  /** อนุญาตตอนเผยแพร่อยู่ — ใช้กับการยกเลิกการเผยแพร่เท่านั้น */
  allowPublished?: boolean;
  /** อนุญาตรอบจากระบบเดิม */
  allowLegacy?: boolean;
  /** อนุญาตตอนมีงานค้าง — ใช้กับการอัปไฟล์ ซึ่งแค่ต่อคิว ไม่ได้แก้ของที่มีอยู่ */
  allowPendingJobs?: boolean;
  /** ต้องมีรายชื่อที่ใช้อยู่แล้ว (เช่นก่อนอัป ZIP) */
  requireRoster?: boolean;
};

export async function withBatchMutation<T>(
  batchId: string,
  fn: (tx: Tx, batch: GuardedBatch) => Promise<T>,
  options: Options = {},
): Promise<T> {
  const result = await prisma.$transaction(
    async (tx) => {
      const batch = await lockBatch(tx, batchId);
      await assertWritable(tx, batch, options);
      return fn(tx, batch);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  return result;
}

/** ตรวจโดยไม่ล็อก — ใช้ก่อนออกลิงก์อัปโหลด จะได้ไม่ให้แอดมินอัปไฟล์ใหญ่ไปเปล่า ๆ */
export async function assertBatchWritable(batchId: string, options: Options = {}): Promise<GuardedBatch> {
  return prisma.$transaction(async (tx) => {
    const batch = await loadBatch(tx, batchId, false);
    await assertWritable(tx, batch, options);
    return batch;
  });
}

async function lockBatch(tx: Tx, batchId: string): Promise<GuardedBatch> {
  return loadBatch(tx, batchId, true);
}

async function loadBatch(tx: Tx, batchId: string, lock: boolean): Promise<GuardedBatch> {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new HttpError(404, "ไม่พบรอบการนำเข้านี้");
  const rows = lock
    ? await tx.$queryRaw<RawBatch[]>`
        SELECT b.id::text, b.status::text AS status, b.profile_key, b.active_roster_import_id::text,
               p.code AS program_code, e.round::text AS round, e.year
        FROM batches b JOIN exams e ON e.id = b.exam_id JOIN exam_programs p ON p.id = e.program_id
        WHERE b.id = ${batchId}::uuid
        FOR UPDATE OF b`
    : await tx.$queryRaw<RawBatch[]>`
        SELECT b.id::text, b.status::text AS status, b.profile_key, b.active_roster_import_id::text,
               p.code AS program_code, e.round::text AS round, e.year
        FROM batches b JOIN exams e ON e.id = b.exam_id JOIN exam_programs p ON p.id = e.program_id
        WHERE b.id = ${batchId}::uuid`;
  const row = rows[0];
  if (!row) throw new HttpError(404, "ไม่พบรอบการนำเข้านี้");
  return {
    id: row.id,
    status: row.status,
    profileKey: row.profile_key,
    activeRosterImportId: row.active_roster_import_id,
    programCode: row.program_code,
    round: row.round as "HEAT" | "FINAL",
    year: row.year,
    label: `${row.program_code} ${row.round} ${row.year}`,
  };
}

type RawBatch = {
  id: string;
  status: string;
  profile_key: string | null;
  active_roster_import_id: string | null;
  program_code: string;
  round: string;
  year: number;
};

async function assertWritable(tx: Tx, batch: GuardedBatch, options: Options) {
  if (batch.status === "DELETING") throw new HttpError(409, "รอบนี้กำลังถูกลบ");
  if (batch.status === "PUBLISHED" && !options.allowPublished) {
    throw new HttpError(409, PUBLISHED_MESSAGE, { code: "PUBLISHED" });
  }
  if (!batch.profileKey && !options.allowLegacy) {
    throw new HttpError(409, LEGACY_MESSAGE, { code: "LEGACY" });
  }
  if (!options.allowPendingJobs) {
    const pending = await tx.job.count({
      where: { batchId: batch.id, type: { in: INTAKE_JOBS }, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (pending > 0) throw new HttpError(409, BUSY_MESSAGE, { code: "BUSY" });
  }
  if (options.requireRoster && !batch.activeRosterImportId) {
    throw new HttpError(409, "ต้องใช้รายชื่อผู้เข้าสอบก่อน จึงจะอัปโหลดเกียรติบัตรได้");
  }
}

/** ตั้งงานให้ worker ในทรานแซกชันเดียวกับการแก้ไข — แก้สำเร็จแต่ตั้งงานไม่ติดจะไม่เกิดขึ้น */
export async function enqueue(
  tx: Tx,
  batchId: string,
  type: JobType,
  payload: Prisma.InputJsonValue = {},
) {
  return tx.job.create({ data: { batchId, type, payload } });
}

/**
 * ตั้งงานจับคู่ใหม่ ถ้ายังไม่มีงานจับคู่รอคิวอยู่ — แก้ติด ๆ กันหลายครั้งจะได้งานเดียว
 * (งานจับคู่คำนวณใหม่ทั้งรอบจากสถานะล่าสุดเสมอ งานเดียวจึงครอบคลุมทุกการแก้ไขที่รออยู่)
 */
export async function enqueueRematch(tx: Tx, batchId: string) {
  const waiting = await tx.job.findFirst({ where: { batchId, type: "MATCH", status: "QUEUED" } });
  return waiting ?? enqueue(tx, batchId, "MATCH");
}

/** เมื่อรายการที่เพิ่มเองเปลี่ยน ร่างรายชื่อที่รอใช้อยู่ต้องตรวจรายการที่ชนใหม่ */
export async function revalidateDraft(tx: Tx, batchId: string) {
  const draft = await tx.rosterImport.findFirst({
    where: { batchId, status: "READY" },
    orderBy: { uploadedAt: "desc" },
  });
  if (draft) await enqueue(tx, batchId, "ROSTER_VALIDATE", { importId: draft.id });
}

/** ปลุก worker หลังทรานแซกชันจบแล้วเท่านั้น — ปลุกก่อน commit worker จะมองไม่เห็นงาน */
export async function afterCommit() {
  await wakeWorker();
}
