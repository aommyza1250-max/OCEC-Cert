/**
 * รายการที่ต้องตามเก็บของรอบนำเข้า — คนที่ระบบรู้ว่ายังขาดไฟล์อะไร
 *
 * ใช้ทั้งตอนแสดงบนหน้าแอดมิน และตอนรับไฟล์ที่แอดมินโยนเข้ามาให้คนนั้น
 * **ต้องเป็นที่เดียวกัน** เพราะฝั่งรับไฟล์ใช้รายการนี้หาว่ารางวัลที่ขาดคืออะไร
 * ถ้าคำนวณคนละที่แล้วเหลื่อมกัน ไฟล์จะถูกบันทึกเป็นรางวัลผิด
 */
import { prisma } from "./db";
import { decidePublish, PERFECT_SCORE, type MultiAwardPolicy } from "./publish";

export type MissingItem = {
  /** เลขผู้เข้าสอบ — ใช้ยืนยันว่าไฟล์ที่อัปเข้ามาเป็นของคนนี้จริง */
  certNo: string;
  name: string;
  /** ปัญหาที่เจอ อธิบายให้แอดมินเข้าใจว่าต้องตามอะไร */
  reason: string;
  /** รางวัลของไฟล์ที่ขาด — ใช้เป็นค่าตั้งต้นถ้าหน้ากระดาษไม่มีข้อความรางวัล */
  expectedAward: string;
  /** ผลของไฟล์ที่อัปเข้ามาให้คนนี้ครั้งล่าสุด ถ้าไม่ถูกรับ — อยู่ติดกับช่องอัปโหลดของคนนั้น
   *  เก็บไว้ที่นี่เพื่อให้ยังเห็นอยู่หลังรีเฟรชหน้า โดยไม่ต้องไปขึ้นซ้ำที่อื่น */
  lastError: string | null;
};

const MISSING_MEDAL = "มีใบ Perfect Score แต่ไม่มีใบเหรียญ — ไฟล์ใบเหรียญตกหล่น";
const NO_CERTIFICATE = "มีชื่อในรายชื่อ Excel แต่ไม่มีหน้าเกียรติบัตรเลย";

export async function loadMissingItems(batchId: string): Promise<MissingItem[]> {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) return [];

  const items = new Map<string, MissingItem>();

  for (const item of await fromHeldStudents(batchId, batch.multiAwardPolicy)) {
    items.set(item.certNo, item);
  }
  // แถวใน Excel ที่ไม่มีหน้าเกียรติบัตรเลย — ตัวจับคู่บันทึกไว้ให้แล้วตอนประมวลผล
  for (const row of readUnmatchedRows(batch.stats)) {
    if (row.certNo && !items.has(row.certNo)) {
      items.set(row.certNo, {
        certNo: row.certNo,
        name: row.name,
        reason: NO_CERTIFICATE,
        expectedAward: row.award || "GOLD",
        lastError: null,
      });
    }
  }

  const errors = await lastUploadErrors(batchId);
  return [...items.values()]
    .map((item) => ({ ...item, lastError: errors.get(item.certNo) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * ผลของไฟล์ที่อัปเข้ามาให้แต่ละคนครั้งล่าสุด เฉพาะที่ไม่ถูกรับ
 *
 * ดูจากงานล่าสุดของเลขผู้เข้าสอบนั้น ถ้าครั้งล่าสุดสำเร็จก็ไม่ต้องแสดงอะไร
 */
async function lastUploadErrors(batchId: string): Promise<Map<string, string>> {
  const jobs = await prisma.job.findMany({
    where: { batchId, type: "SPLIT" },
    select: { status: true, error: true, userError: true, payload: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const seen = new Map<string, string>();
  for (const job of jobs) {
    const certNo = (job.payload as { expectCertNo?: unknown })?.expectCertNo;
    if (typeof certNo !== "string" || seen.has(certNo)) continue;
    // จองที่ไว้ทุกกรณี เพื่อให้เห็นเฉพาะผลของครั้งล่าสุด ไม่ใช่ครั้งที่พังครั้งไหนก็ได้
    seen.set(certNo, "");
    if (job.status === "FAILED" && job.userError && job.error) {
      seen.set(certNo, job.error.split("\n")[0]);
    }
  }

  return new Map([...seen].filter(([, message]) => message !== ""));
}

/**
 * คนที่ถูกกันไม่ให้เผยแพร่เพราะข้อมูลไม่ครบ
 *
 * ตอนนี้มีกรณีเดียว: มีใบ Perfect Score แต่ไม่มีใบเหรียญ
 * รู้ได้เลยว่าไฟล์ที่ขาดคือเหรียญทอง เพราะ Perfect Score ให้เฉพาะคนที่ได้เหรียญทอง
 */
async function fromHeldStudents(
  batchId: string,
  policy: MultiAwardPolicy,
): Promise<MissingItem[]> {
  const certificates = await prisma.certificate.findMany({
    where: { batchId },
    select: {
      id: true,
      award: true,
      certNo: true,
      studentId: true,
      student: { select: { nameEn: true, nameTh: true } },
    },
  });

  const byStudent = new Map<string, typeof certificates>();
  for (const c of certificates) {
    byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c]);
  }

  const decision = decidePublish(
    [...byStudent.entries()].map(([studentId, certs]) => ({
      studentId,
      certificates: certs.map((c) => ({ id: c.id, award: c.award })),
    })),
    policy,
  );

  return decision.heldStudents.flatMap((held) => {
    const certs = byStudent.get(held.studentId) ?? [];
    const certNo = certs.find((c) => c.certNo)?.certNo;
    if (!certNo) return [];
    const student = certs[0].student;
    return [
      {
        certNo,
        name: student.nameEn ?? student.nameTh ?? "ไม่ระบุชื่อ",
        reason: MISSING_MEDAL,
        // Perfect Score ให้เฉพาะคนที่ได้เหรียญทอง ใบที่ขาดจึงเป็นเหรียญทองเสมอ
        expectedAward: "GOLD",
        lastError: null,
      },
    ];
  });
}

type UnmatchedRow = { certNo: string; name: string; award: string | null };

function readUnmatchedRows(stats: unknown): UnmatchedRow[] {
  const rows = (stats as { unmatchedRows?: unknown })?.unmatchedRows;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      certNo: String(r.certNo ?? ""),
      name: String(r.name ?? "ไม่ระบุชื่อ"),
      award: typeof r.award === "string" ? r.award : null,
    }));
}

export { PERFECT_SCORE };
