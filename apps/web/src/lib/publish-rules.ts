/**
 * กติกาการเผยแพร่ล้วน ๆ (ไม่แตะฐานข้อมูล) — แยกไฟล์ไว้ให้หน้าจอฝั่งเบราว์เซอร์ใช้ป้ายเหตุผลได้
 * โดยไม่ลาก Prisma ไปด้วย ตัวลงมือเผยแพร่อยู่ที่ publish.ts
 *
 * คนที่มีแต่ใบรางวัลเสริมต้องให้แอดมินตรวจและยืนยันชุดไฟล์ที่ได้รับจริงก่อนเผยแพร่
 */
export type MultiAwardPolicy = "UNDECIDED" | "ALL" | "MEDAL_ONLY";
export type Mode = "ONLINE" | "ONSITE";

export type HoldReason =
  | "NAME_MISMATCH"
  | "MODE_MISMATCH"
  | "AMBIGUOUS"
  | "DUPLICATE_REVIEW"
  | "NATIONALITY_UNVERIFIED"
  | "PARSE_REVIEW"
  | "IMAGE_PENDING"
  | "MISSING_FILE"
  | "MISSING_PRIMARY";

/** ลำดับความสำคัญของเหตุผล — คนหนึ่งติดหลายเรื่องจะแสดงเรื่องที่ต้องแก้ก่อน */
export const HOLD_REASONS: HoldReason[] = [
  "NAME_MISMATCH",
  "MODE_MISMATCH",
  "AMBIGUOUS",
  "DUPLICATE_REVIEW",
  "NATIONALITY_UNVERIFIED",
  "PARSE_REVIEW",
  "IMAGE_PENDING",
  "MISSING_FILE",
  "MISSING_PRIMARY",
];

export const HOLD_LABELS: Record<HoldReason, string> = {
  NAME_MISMATCH: "ชื่อบนเกียรติบัตรไม่ตรงกับรายชื่อ",
  MODE_MISMATCH: "ไฟล์อยู่ผิดโฟลเดอร์ online/onsite",
  AMBIGUOUS: "ระบุตัวไม่ได้ ต้องเลือกเอง",
  DUPLICATE_REVIEW: "มีใบซ้ำรอตัดสิน",
  NATIONALITY_UNVERIFIED: "รอยืนยันสัญชาติ",
  PARSE_REVIEW: "รอบ/ปีบนหน้าไม่ตรง รอตรวจ",
  IMAGE_PENDING: "รูปเกียรติบัตรยังแปลงไม่สำเร็จ — รอระบบลองอีกครั้ง",
  MISSING_FILE: "ยังไม่มีไฟล์เกียรติบัตร",
  MISSING_PRIMARY: "มีแต่ใบรางวัลเสริม — ตรวจว่าได้รับเฉพาะใบที่มีอยู่จริงหรือไม่",
};

export type CertificateRef = {
  id: string;
  award: string;
  kind: "PRIMARY" | "SUPPLEMENTAL";
  pdfKey: string | null;
  previewKey: string | null;
};

export type Participant = {
  entryId: string;
  mode: Mode;
  certificates: CertificateRef[];
  /** ปัญหาของหน้าที่เป็นของคนนี้ซึ่งยังไม่ได้ตัดสิน */
  issues: HoldReason[];
  /** แอดมินยืนยันชุดไฟล์รางวัลเสริมชุดปัจจุบันแล้ว (ไฟล์เปลี่ยน = หมดผล) */
  supplementalOnlyApproved?: boolean;
};

/** ตรึงการยืนยันกับใบ/รางวัล/รูปที่ใช้จริง — เปลี่ยนไฟล์แล้วต้องตรวจใหม่ */
export function supplementalOnlySnapshot(certificates: CertificateRef[]): string | null {
  if (!certificates.length || certificates.some((c) => c.kind === "PRIMARY" || c.pdfKey !== null || !c.previewKey)) return null;
  return JSON.stringify(
    certificates
      .map((c): [string, string, string | null] => [c.id, c.award, c.previewKey])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

export type PublishDecision = {
  /** ให้ผู้ปกครองค้นเจอ */
  publish: string[];
  /** กันไว้ทั้งคนเพราะข้อมูลของคนนั้นยังไม่ครบหรือยังมีเรื่องต้องตัดสิน */
  held: string[];
  /** ไม่เผยแพร่ตามที่แอดมินเลือกไว้สำหรับรอบนี้ */
  hiddenByPolicy: string[];
  heldParticipants: { entryId: string; mode: Mode; reason: HoldReason }[];
  publishedParticipants: { entryId: string; mode: Mode }[];
};

/**
 * ตัดสินจากชุดเกียรติบัตรและปัญหาของแต่ละคน — ฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 *
 * ลำดับการตัดสิน:
 *   1. มีหน้าที่ยังรอตัดสิน (ชื่อ/รูปแบบไม่ตรง ระบุตัวไม่ได้ ใบซ้ำ สัญชาติ รอบ/ปี) -> กันไว้ทั้งคน
 *   2. ยังไม่มีใบเลย -> กันไว้ (ไฟล์ยังไม่มา)
 *   3. มีแต่ใบรางวัลเสริม -> กันไว้จนกว่าแอดมินจะยืนยันไฟล์ชุดนี้
 *   4. ถ้ามีรางวัลหลักด้วยและรอบนี้ตั้งให้แสดงแค่รางวัลหลัก -> ซ่อนใบรางวัลเสริม
 *   5. นอกนั้นเผยแพร่ทั้งหมด
 */
export function decidePublish(participants: Participant[], policy: MultiAwardPolicy): PublishDecision {
  const decision: PublishDecision = {
    publish: [],
    held: [],
    hiddenByPolicy: [],
    heldParticipants: [],
    publishedParticipants: [],
  };

  for (const person of participants) {
    const primary = person.certificates.filter((c) => c.kind === "PRIMARY");
    const supplemental = person.certificates.filter((c) => c.kind === "SUPPLEMENTAL");
    const reason = holdReason(person, primary.length, supplemental.length);

    if (reason) {
      decision.held.push(...person.certificates.map((c) => c.id));
      decision.heldParticipants.push({ entryId: person.entryId, mode: person.mode, reason });
      continue;
    }

    decision.publishedParticipants.push({ entryId: person.entryId, mode: person.mode });
    if (policy === "MEDAL_ONLY" && primary.length > 0 && supplemental.length > 0) {
      decision.hiddenByPolicy.push(...supplemental.map((c) => c.id));
      decision.publish.push(...primary.map((c) => c.id));
      continue;
    }
    decision.publish.push(...person.certificates.map((c) => c.id));
  }
  return decision;
}

function holdReason(person: Participant, primary: number, supplemental: number): HoldReason | null {
  const issue = HOLD_REASONS.find((r) => person.issues.includes(r));
  if (issue) return issue;
  if (primary + supplemental === 0) return "MISSING_FILE";
  if (person.certificates.some((c) => c.pdfKey !== null || !c.previewKey)) return "IMAGE_PENDING";
  if (primary === 0 && !person.supplementalOnlyApproved) return "MISSING_PRIMARY";
  return null;
}

/** ต้องให้แอดมินเลือกก่อนไหม — เฉพาะเมื่อมีคนที่จะเผยแพร่ได้ถือทั้งใบรางวัลหลักและรางวัลเสริม */
export function needsPolicyDecision(participants: Participant[]): boolean {
  return participants.some(
    (p) =>
      !HOLD_REASONS.some((r) => p.issues.includes(r)) &&
      p.certificates.every((c) => c.pdfKey === null && !!c.previewKey) &&
      p.certificates.some((c) => c.kind === "PRIMARY") &&
      p.certificates.some((c) => c.kind === "SUPPLEMENTAL"),
  );
}

export type PublishSummary = {
  toPublish: { participants: number; certificates: number; byMode: Record<Mode, number> };
  held: {
    participants: number;
    certificates: number;
    byReason: { reason: HoldReason; label: string; ONLINE: number; ONSITE: number }[];
  };
  hiddenByPolicy: number;
};

/** ตัวเลขที่ต้องบอกแอดมินก่อนกดเผยแพร่ — แยกตามเหตุผลและรูปแบบการสอบ */
export function summarize(decision: PublishDecision): PublishSummary {
  const byMode: Record<Mode, number> = { ONLINE: 0, ONSITE: 0 };
  for (const p of decision.publishedParticipants) byMode[p.mode] += 1;

  const byReason = HOLD_REASONS.map((reason) => {
    const rows = decision.heldParticipants.filter((h) => h.reason === reason);
    return {
      reason,
      label: HOLD_LABELS[reason],
      ONLINE: rows.filter((h) => h.mode === "ONLINE").length,
      ONSITE: rows.filter((h) => h.mode === "ONSITE").length,
    };
  }).filter((r) => r.ONLINE + r.ONSITE > 0);

  return {
    toPublish: {
      participants: decision.publishedParticipants.length,
      certificates: decision.publish.length,
      byMode,
    },
    held: {
      participants: decision.heldParticipants.length,
      certificates: decision.held.length,
      byReason,
    },
    hiddenByPolicy: decision.hiddenByPolicy.length,
  };
}
