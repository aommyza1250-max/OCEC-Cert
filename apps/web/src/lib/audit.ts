/**
 * บันทึกการแก้ไขของแอดมิน (ฝั่งเว็บ) — เขียนในทรานแซกชันเดียวกับการแก้ไขจริงเสมอ
 *
 * ระบบใช้รหัสผ่านร่วมกัน จึงบันทึกได้แค่รหัส session ไม่ใช่ชื่อคน
 * ห้ามเขียนข้อความหรือหน้าจอที่ทำให้เข้าใจว่ารู้ว่าใครทำ
 */
import type { Prisma } from "@prisma/client";
import type { GuardedBatch, Tx } from "./batch-guard";

export type AuditAction =
  | "ROSTER_ENTRY_CREATED"
  | "ROSTER_ENTRY_UPDATED"
  | "ROSTER_ENTRY_DELETED"
  | "STUDENT_LINKED"
  | "STUDENT_SEPARATED"
  | "STUDENT_RENAMED"
  | "MODE_MISMATCH_CONFIRMED"
  | "NATIONALITY_CONFIRMED"
  | "MARKED_FOREIGN"
  | "PARSE_REVIEW_ACCEPTED"
  | "PAGE_LINKED_MANUALLY"
  | "CERTIFICATE_DISCARDED"
  | "CERTIFICATE_RESTORED"
  | "AWARD_RECLASSIFIED"
  | "DUPLICATE_RESOLVED"
  | "UPLOAD_DISCARDED"
  | "CERTIFICATE_UPLOAD_REQUESTED"
  | "ROSTER_ACTIVATION_REQUESTED"
  | "ROSTER_DRAFT_DISCARDED"
  | "POLICY_CHANGED"
  | "PUBLISHED"
  | "PUBLICATION_WITHDRAWN"
  | "BATCH_DELETE_REQUESTED";

export async function recordAudit(
  tx: Tx,
  batch: Pick<GuardedBatch, "id" | "label">,
  event: {
    entityType: "BATCH" | "ROSTER_ENTRY" | "STAGING_PAGE" | "CERTIFICATE" | "ROSTER_IMPORT" | "JOB";
    entityId?: string | null;
    action: AuditAction;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
    sessionId: string;
    note?: string | null;
  },
) {
  await tx.auditEvent.create({
    data: {
      batchId: batch.id,
      batchLabel: batch.label,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      action: event.action,
      before: event.before ?? undefined,
      after: event.after ?? undefined,
      sessionId: event.sessionId,
      note: event.note ?? null,
    },
  });
}

/** ชื่อการกระทำที่แสดงในหน้าประวัติ */
export const AUDIT_LABELS: Record<string, string> = {
  ROSTER_ACTIVATED: "ใช้รายชื่อชุดใหม่",
  ROSTER_CONFLICT_RESOLVED: "ตัดสินรายการที่ชนกับผู้เข้าสอบที่เพิ่มเอง",
  ROSTER_ACTIVATION_REQUESTED: "สั่งใช้รายชื่อชุดใหม่",
  ROSTER_DRAFT_DISCARDED: "ทิ้งร่างรายชื่อ",
  ROSTER_ENTRY_CREATED: "เพิ่มผู้เข้าสอบเอง",
  ROSTER_ENTRY_UPDATED: "แก้ข้อมูลผู้เข้าสอบ",
  ROSTER_ENTRY_DELETED: "ลบผู้เข้าสอบที่เพิ่มเอง",
  STUDENT_LINKED: "เลือกตัวคนให้ผู้เข้าสอบ",
  STUDENT_SEPARATED: "แยกเป็นคนใหม่",
  STUDENT_RENAMED: "แก้ชื่อตัวคน (มีผลทุกรายการสอบ)",
  MODE_MISMATCH_CONFIRMED: "ยืนยันใช้รูปแบบการสอบตามรายชื่อ",
  NATIONALITY_CONFIRMED: "ยืนยันว่าเป็นผู้เข้าสอบไทย",
  MARKED_FOREIGN: "ระบุว่าเป็นผู้เข้าสอบต่างชาติ",
  PARSE_REVIEW_ACCEPTED: "ยอมรับหน้าที่รอบ/ปีไม่ตรง",
  PAGE_LINKED_MANUALLY: "จับคู่หน้าด้วยมือ",
  CERTIFICATE_DISCARDED: "ทิ้งหน้า/เกียรติบัตร",
  CERTIFICATE_RESTORED: "คืนหน้าที่ทิ้งไว้",
  AWARD_RECLASSIFIED: "เปลี่ยนรางวัล",
  DUPLICATE_RESOLVED: "ตัดสินใบซ้ำ",
  UPLOAD_DISCARDED: "ทิ้งทุกหน้าจากไฟล์ที่อัป",
  CERTIFICATE_UPLOAD_REQUESTED: "อัปไฟล์เกียรติบัตรให้ผู้เข้าสอบ",
  CERTIFICATE_ADDED: "เพิ่มเกียรติบัตร",
  CERTIFICATE_FILE_REPLACED: "เปลี่ยนไฟล์เกียรติบัตร",
  POLICY_CHANGED: "เปลี่ยนตัวเลือกใบรางวัลเสริม",
  PUBLISHED: "เผยแพร่",
  PUBLICATION_WITHDRAWN: "ยกเลิกการเผยแพร่",
  BATCH_DELETE_REQUESTED: "สั่งลบรอบนำเข้า",
};
