/**
 * ตัดสินว่าเกียรติบัตรใบไหนจะให้ผู้ปกครองค้นเจอ
 *
 * **ที่นี่คือที่เดียวในระบบที่เขียนสถานะเผยแพร่** ตัวจับคู่ฝั่ง worker จะไม่แตะค่านี้เลย
 * แค่รักษาค่าเดิมไว้ตอนสร้างเกียรติบัตรใหม่ ถ้ามีสองที่เขียน กฎจะเหลื่อมกันวันใดวันหนึ่ง
 * แล้วใบที่ควรถูกกันไว้จะหลุดออกไปให้ผู้ปกครองโหลดโดยไม่มีอะไรฟ้อง
 *
 * กติกาการให้รางวัล: Gold คือรางวัลหลัก ส่วน Perfect Score เป็นรางวัลเสริม
 * ที่ให้คนได้เหรียญทองซึ่งทำคะแนนได้ดี **คนที่มี Perfect Score จึงต้องมีใบเหรียญเสมอ**
 */
import { prisma } from "./db";

export const PERFECT_SCORE = "PERFECT_SCORE";

export type MultiAwardPolicy = "UNDECIDED" | "ALL" | "MEDAL_ONLY";

type CertificateRef = { id: string; award: string };
type PersonCertificates = { studentId: string; certificates: CertificateRef[] };

export type PublishDecision = {
  /** ให้ผู้ปกครองค้นเจอ */
  publish: string[];
  /** กันไว้ทั้งคนเพราะข้อมูลของคนนั้นยังไม่ครบ */
  held: string[];
  /** ไม่เผยแพร่ตามที่แอดมินเลือกไว้สำหรับรอบนี้ */
  hiddenByPolicy: string[];
  /** คนที่ถูกกันไว้ พร้อมเหตุผล — เอาไปแสดงให้แอดมินตามเก็บ */
  heldStudents: { studentId: string; reason: string }[];
};

/**
 * ตัดสินจากชุดเกียรติบัตรของแต่ละคน — ฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 *
 * ลำดับการตัดสิน:
 *   1. มี Perfect Score แต่ไม่มีใบเหรียญเลย = ไฟล์เหรียญตกหล่น (เป็นไปไม่ได้ตามกติกาการให้รางวัล)
 *      -> กันไว้ทั้งคน ไม่ใช่กันเฉพาะใบนั้น เพราะสิ่งที่ผู้ปกครองควรได้คือใบเหรียญที่ยังมาไม่ถึง
 *   2. รอบนี้ตั้งไว้ว่าส่งฉบับจริงแค่ใบเหรียญ -> ซ่อนใบ Perfect Score
 *   3. นอกนั้นเผยแพร่ทั้งหมด
 */
export function decidePublish(
  people: PersonCertificates[],
  policy: MultiAwardPolicy,
): PublishDecision {
  const decision: PublishDecision = {
    publish: [],
    held: [],
    hiddenByPolicy: [],
    heldStudents: [],
  };

  for (const person of people) {
    const perfect = person.certificates.filter((c) => c.award === PERFECT_SCORE);
    const medals = person.certificates.filter((c) => c.award !== PERFECT_SCORE);

    if (perfect.length > 0 && medals.length === 0) {
      decision.held.push(...person.certificates.map((c) => c.id));
      decision.heldStudents.push({
        studentId: person.studentId,
        reason: "มีใบ Perfect Score แต่ไม่มีใบเหรียญ — ไฟล์ใบเหรียญน่าจะตกหล่น",
      });
      continue;
    }

    if (policy === "MEDAL_ONLY" && perfect.length > 0) {
      decision.hiddenByPolicy.push(...perfect.map((c) => c.id));
      decision.publish.push(...medals.map((c) => c.id));
      continue;
    }

    decision.publish.push(...person.certificates.map((c) => c.id));
  }

  return decision;
}

/** รอบนี้ต้องให้แอดมินเลือกก่อนไหม — ต้องเลือกเฉพาะเมื่อมีคนถือทั้งใบเหรียญและ Perfect Score */
export function needsPolicyDecision(people: PersonCertificates[]): boolean {
  return people.some(
    (p) =>
      p.certificates.some((c) => c.award === PERFECT_SCORE) &&
      p.certificates.some((c) => c.award !== PERFECT_SCORE),
  );
}

/** อ่านเกียรติบัตรของรอบนำเข้ามาจัดกลุ่มตามผู้เข้าสอบ */
export async function loadPeople(batchId: string): Promise<PersonCertificates[]> {
  const certificates = await prisma.certificate.findMany({
    where: { batchId },
    select: { id: true, award: true, studentId: true },
    orderBy: { pageNumber: "asc" },
  });

  const byStudent = new Map<string, CertificateRef[]>();
  for (const c of certificates) {
    const list = byStudent.get(c.studentId) ?? [];
    list.push({ id: c.id, award: c.award });
    byStudent.set(c.studentId, list);
  }
  return [...byStudent.entries()].map(([studentId, certs]) => ({
    studentId,
    certificates: certs,
  }));
}

/**
 * ลงมือเผยแพร่หรือยกเลิกเผยแพร่ทั้งรอบ
 *
 * เผยแพร่ซ้ำได้เรื่อย ๆ — เรียกอีกครั้งหลังเติมไฟล์ที่ตกหล่น
 * คนที่ข้อมูลครบแล้วจะถูกเผยแพร่เพิ่มให้ ส่วนคนที่ยังไม่ครบก็ยังค้างอยู่เหมือนเดิม
 */
/** อายุการเก็บเกียรติบัตรนับจากวันเผยแพร่ */
export const RETENTION_MONTHS = Number(process.env.RETENTION_MONTHS) || 24;

function addMonths(from: Date, months: number): Date {
  const out = new Date(from);
  out.setMonth(out.getMonth() + months);
  return out;
}

export async function applyPublish(batchId: string, publish: boolean) {
  const people = await loadPeople(batchId);

  if (!publish) {
    await prisma.$transaction([
      prisma.certificate.updateMany({ where: { batchId }, data: { published: null } }),
      prisma.batch.update({ where: { id: batchId }, data: { status: "READY" } }),
    ]);
    return { published: 0, held: 0, hiddenByPolicy: 0, heldStudents: [] };
  }

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
  const decision = decidePublish(people, batch.multiAwardPolicy);

  const now = new Date();
  await prisma.$transaction([
    prisma.certificate.updateMany({
      where: { id: { in: decision.publish } },
      data: { published: now },
    }),
    // ตั้งวันหมดอายุตอนเผยแพร่ครั้งแรกเท่านั้น (expiresAt ยังว่าง)
    // เผยแพร่ซ้ำหลังแก้ไขไม่รีเซ็ตนาฬิกา ไม่งั้นการแก้อะไรเล็กน้อยจะยืดอายุออกไปอีก 2 ปีเงียบ ๆ
    prisma.certificate.updateMany({
      where: { id: { in: decision.publish }, expiresAt: null },
      data: { expiresAt: addMonths(now, RETENTION_MONTHS) },
    }),
    prisma.certificate.updateMany({
      where: { id: { in: [...decision.held, ...decision.hiddenByPolicy] } },
      data: { published: null },
    }),
    prisma.batch.update({ where: { id: batchId }, data: { status: "PUBLISHED" } }),
  ]);

  return {
    published: decision.publish.length,
    held: decision.held.length,
    hiddenByPolicy: decision.hiddenByPolicy.length,
    heldStudents: decision.heldStudents,
  };
}
