/**
 * ตัดสินว่าเกียรติบัตรใบไหนจะให้ผู้ปกครองค้นเจอ
 *
 * **ที่นี่คือที่เดียวในระบบที่เขียนสถานะเผยแพร่** ตัวจับคู่ฝั่ง worker จะไม่แตะค่านี้เลย
 * ถ้ามีสองที่เขียน กฎจะเหลื่อมกันวันใดวันหนึ่ง แล้วใบที่ควรถูกกันไว้จะหลุดออกไปให้ผู้ปกครองโหลด
 * โดยไม่มีอะไรฟ้อง
 *
 * เผยแพร่ **รายคน** — คนที่ข้อมูลครบและไม่มีอะไรค้างออกไปก่อน ส่วนคนที่ยังมีปัญหาค้างไว้ทั้งคน
 * (ไม่ปล่อยออกไปบางใบ เพราะผู้ปกครองจะเข้าใจผิดว่านั่นคือรางวัลทั้งหมดที่ได้)
 *
 * กติกาการตัดสินอยู่ที่ publish-rules.ts (ไม่แตะฐานข้อมูล ทดสอบได้ตรง ๆ)
 */
import type { GuardedBatch, Tx } from "./batch-guard";
import { awardCatalog } from "./certificate-catalog";
import { prisma } from "./db";
import {
  decidePublish,
  summarize,
  type CertificateRef,
  type HoldReason,
  type MultiAwardPolicy,
  type Participant,
} from "./publish-rules";

export {
  decidePublish,
  HOLD_LABELS,
  HOLD_REASONS,
  needsPolicyDecision,
  summarize,
  type HoldReason,
  type Mode,
  type MultiAwardPolicy,
  type Participant,
  type PublishDecision,
  type PublishSummary,
} from "./publish-rules";

// ---------------------------------------------------------------- อ่านจากฐานข้อมูล

const ISSUE_OF_STATUS: Record<string, HoldReason> = {
  NAME_MISMATCH: "NAME_MISMATCH",
  MODE_MISMATCH: "MODE_MISMATCH",
  AMBIGUOUS: "AMBIGUOUS",
  DUPLICATE_NAME: "DUPLICATE_REVIEW",
  NATIONALITY_UNVERIFIED: "NATIONALITY_UNVERIFIED",
  PARSE_REVIEW: "PARSE_REVIEW",
};

type Db = Tx | typeof prisma;

/** อ่านผู้เข้าสอบทุกคนในรายชื่อ พร้อมใบที่ออกแล้วและปัญหาที่ยังค้าง */
export async function loadParticipants(
  db: Db,
  batch: Pick<GuardedBatch, "id" | "programCode" | "round">,
): Promise<Participant[]> {
  const kinds = new Map(awardCatalog(batch.programCode, batch.round).map((a) => [a.code, a.kind]));
  const [entries, certificates, pages] = await Promise.all([
    db.rosterEntry.findMany({
      where: { batchId: batch.id },
      select: { id: true, candidateNo: true, examMode: true },
      orderBy: { candidateNo: "asc" },
    }),
    db.certificate.findMany({
      where: { batchId: batch.id, rosterEntryId: { not: null } },
      select: { id: true, award: true, rosterEntryId: true },
      orderBy: { pageNumber: "asc" },
    }),
    db.stagingPage.findMany({
      where: { batchId: batch.id, matchStatus: { in: Object.keys(ISSUE_OF_STATUS) as never } },
      select: { matchStatus: true, rosterEntryId: true, certNo: true, review: true },
    }),
  ]);

  const byNumber = new Map(entries.map((e) => [e.candidateNo, e.id]));
  const issues = new Map<string, Set<HoldReason>>();
  const attach = (entryId: string | null | undefined, reason: HoldReason) => {
    if (!entryId) return;
    issues.set(entryId, (issues.get(entryId) ?? new Set()).add(reason));
  };
  for (const page of pages) {
    const reason = ISSUE_OF_STATUS[page.matchStatus];
    const candidates = (page.review as { candidateEntryIds?: unknown } | null)?.candidateEntryIds;
    if (page.rosterEntryId) attach(page.rosterEntryId, reason);
    else if (Array.isArray(candidates)) candidates.forEach((id) => attach(String(id), reason));
    // หน้าที่ติดตั้งแต่ตอนตัด (สัญชาติ/รอบปี) ยังไม่ผูกกับใคร แต่เลขบนหน้าบอกได้ว่าเป็นของใคร
    else if (page.certNo) attach(byNumber.get(page.certNo), reason);
  }

  const certsByEntry = new Map<string, CertificateRef[]>();
  for (const c of certificates) {
    const list = certsByEntry.get(c.rosterEntryId!) ?? [];
    list.push({ id: c.id, award: c.award, kind: kinds.get(c.award) ?? "PRIMARY" });
    certsByEntry.set(c.rosterEntryId!, list);
  }

  return entries.map((e) => ({
    entryId: e.id,
    mode: e.examMode,
    certificates: certsByEntry.get(e.id) ?? [],
    issues: [...(issues.get(e.id) ?? [])],
  }));
}

// ---------------------------------------------------------------- ลงมือ

/** อายุการเก็บเกียรติบัตรนับจากวันเผยแพร่ */
export const RETENTION_MONTHS = Number(process.env.RETENTION_MONTHS) || 24;

function addMonths(from: Date, months: number): Date {
  const out = new Date(from);
  out.setMonth(out.getMonth() + months);
  return out;
}

/**
 * ยกเลิกการเผยแพร่ทั้งรอบ — ผู้ปกครองค้นไม่เจอทั้งรอบจนกว่าจะกดเผยแพร่อีกครั้ง
 * ต้องทำก่อนแก้ไขหรืออัปอะไรเสมอ
 */
export async function withdraw(tx: Tx, batch: GuardedBatch) {
  const { count } = await tx.certificate.updateMany({
    where: { batchId: batch.id, published: { not: null } },
    data: { published: null },
  });
  await tx.batch.update({
    where: { id: batch.id },
    data: { status: batch.activeRosterImportId || !batch.profileKey ? "READY" : "DRAFT" },
  });
  return { withdrawn: count };
}

/**
 * เผยแพร่ทุกใบที่พร้อม — เรียกซ้ำได้ ทุกครั้งคำนวณใหม่จากสถานะล่าสุด
 * คนที่แก้เสร็จแล้วจะตามออกไปเอง คนที่ยังมีปัญหาก็ยังค้างเหมือนเดิม
 */
export async function publish(tx: Tx, batch: GuardedBatch, policy: MultiAwardPolicy) {
  const decision = decidePublish(await loadParticipants(tx, batch), policy);
  const now = new Date();
  await tx.certificate.updateMany({ where: { id: { in: decision.publish } }, data: { published: now } });
  // ตั้งวันหมดอายุตอนเผยแพร่ครั้งแรกเท่านั้น (expiresAt ยังว่าง)
  // เผยแพร่ซ้ำหลังแก้ไขไม่รีเซ็ตนาฬิกา ไม่งั้นการแก้อะไรเล็กน้อยจะยืดอายุออกไปอีก 2 ปีเงียบ ๆ
  await tx.certificate.updateMany({
    where: { id: { in: decision.publish }, expiresAt: null },
    data: { expiresAt: addMonths(now, RETENTION_MONTHS) },
  });
  await tx.certificate.updateMany({
    where: { batchId: batch.id, id: { notIn: decision.publish } },
    data: { published: null },
  });
  await tx.batch.update({ where: { id: batch.id }, data: { status: "PUBLISHED" } });
  return summarize(decision);
}
