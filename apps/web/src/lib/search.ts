/** ตรรกะการค้นหาของหน้าสาธารณะ */
import { awardDisplay } from "./certificate-catalog";
import { MIN_QUERY_LENGTH } from "./constants";
import { prisma } from "./db";
import { normalizeName, roundRank } from "./normalize";
import { publicUrl } from "./r2";

/** ต่ำกว่า MIN_QUERY_LENGTH ไม่ยอมค้นให้ — กันคนพิมพ์ตัวอักษรเดียวแล้วไล่ดูดรายชื่อทั้งฐาน
 *  ค่าอยู่ใน constants.ts เพราะ client component ก็ต้องใช้ */
export { MIN_QUERY_LENGTH };

/** จำกัดจำนวนคนต่อการค้นหา 1 ครั้ง ด้วยเหตุผลเดียวกัน */
const MAX_STUDENTS = 20;

export type CertificateItem = {
  id: string;
  year: number;
  round: string;
  /** รหัสรางวัลของรายการนั้นจริง ๆ เช่น GOLD หรือ 1ST_PRIZE ของ BBB */
  award: string;
  /** ชื่อรางวัลที่ผู้ปกครองเห็น — ใช้ชื่อที่บันทึกไว้ตอนออกใบก่อนเสมอ */
  awardLabel: string;
  awardLabelTh: string | null;
  /** สีของป้ายรางวัล (gold, silver, ..., participation, special) */
  badge: string;
  /** ลำดับการแสดงผลในกลุ่มเดียวกัน — รางวัลหลักก่อน รางวัลเสริมทีหลัง */
  order: number;
  level: string | null;
  certNo: string | null;
  previewUrl: string | null;
};

/** เกียรติบัตรของ "รายการสอบ + รอบ + ปี" หนึ่งชุด
 *
 *  แยกถึงระดับรอบ เพราะคนเดียวอาจได้ทั้งรอบคัดเลือกและรอบชิงชนะเลิศในปีเดียวกัน
 *  ถ้าเอามารวมกองเดียว การ์ดสองใบจะหน้าตาเกือบเหมือนกันจนผู้ปกครองกดผิดใบ */
export type ExamSession = {
  year: number;
  round: string;
  certificates: CertificateItem[];
};

export type ProgramGroup = {
  code: string;
  name: string;
  /** ปีล่าสุดของรายการสอบนี้ ใช้เรียงว่ารายการไหนควรอยู่บน */
  latestYear: number;
  /** ปีใหม่อยู่บน และในปีเดียวกันรอบชิงชนะเลิศมาก่อนรอบคัดเลือก */
  sessions: ExamSession[];
};

export type SearchResult = {
  studentId: string;
  nameTh: string | null;
  nameEn: string | null;
  /** โรงเรียน — มีเฉพาะเมื่อแอดมินกรอกเอง หรือชีทรายชื่อมีคอลัมน์โรงเรียนมาให้
   *  เกียรติบัตรไม่มีข้อความโรงเรียนพิมพ์อยู่ จึงดึงจากไฟล์ไม่ได้ */
  school: string | null;
  /** ระดับชั้นของใบล่าสุด — ตัวช่วยยืนยันตัวคนที่มีข้อมูลจริงเสมอ
   *  ใช้แทนโรงเรียนในหัวการ์ด เพราะชีทรายชื่อมีคอลัมน์ GRADE ทุกแถว */
  latestLevel: string | null;
  /** จัดกลุ่มตามรายการสอบก่อน แล้วค่อยแยกปีข้างใน */
  programs: ProgramGroup[];
};

export async function searchStudents(rawQuery: string): Promise<SearchResult[]> {
  const q = normalizeName(rawQuery);
  if (q.length < MIN_QUERY_LENGTH) return [];

  const students = await prisma.student.findMany({
    where: {
      // ต้องมีเกียรติบัตรที่ publish แล้วและไฟล์ยังอยู่อย่างน้อย 1 ใบ ไม่งั้นไม่ต้องโผล่มา
      certificates: { some: { published: { not: null }, filesDeletedAt: null } },
      // ค้นจากชื่อภาษาอังกฤษอย่างเดียว เพราะทั้งชีทรายชื่อและตัวเกียรติบัตรเป็นอังกฤษล้วน
      // ชื่อไทยในฐานมีเฉพาะที่แอดมินกรอกเอง ค้นจากมันจะเจอบ้างไม่เจอบ้างจนคาดเดาไม่ได้
      nameEnNormalized: { contains: q },
    },
    take: MAX_STUDENTS,
    include: {
      certificates: {
        // ใบที่ครบอายุการเก็บแล้วไฟล์ถูกลบไปแล้ว จึงไม่มีอะไรให้ดาวน์โหลด
        where: { published: { not: null }, filesDeletedAt: null },
        include: { exam: { include: { program: true } } },
        orderBy: { exam: { year: "desc" } },
      },
    },
  });

  return students.map(toSearchResult).sort(byRelevance(q));
}

type CertificateRow = {
  id: string;
  award: string;
  awardLabel?: string | null;
  awardLabelTh?: string | null;
  level: string | null;
  certNo: string | null;
  previewKey: string | null;
  exam: { year: number; round: string; program: { code: string; name: string } };
};

export function toSearchResult(student: {
  id: string;
  nameTh: string | null;
  nameEn: string | null;
  school: string | null;
  certificates: CertificateRow[];
}): SearchResult {
  // code -> "ปี|รอบ" -> เกียรติบัตร
  const byProgram = new Map<string, { name: string; sessions: Map<string, ExamSession> }>();

  for (const cert of student.certificates) {
    const { code, name } = cert.exam.program;
    const program = byProgram.get(code) ?? { name, sessions: new Map() };
    byProgram.set(code, program);

    const { year, round } = cert.exam;
    const key = `${year}|${round}`;
    const session = program.sessions.get(key) ?? { year, round, certificates: [] };
    const shown = awardDisplay(code, cert.award, { label: cert.awardLabel, labelTh: cert.awardLabelTh });
    session.certificates.push({
      id: cert.id,
      year,
      round,
      award: cert.award,
      awardLabel: shown.label,
      awardLabelTh: shown.labelTh,
      badge: shown.badge,
      order: shown.order,
      level: cert.level,
      certNo: cert.certNo,
      previewUrl: cert.previewKey ? publicUrl(cert.previewKey) : null,
    });
    program.sessions.set(key, session);
  }

  const programs = [...byProgram.entries()]
    .map(([code, program]) => {
      const sessions = [...program.sessions.values()].sort(bySession);
      // ในกลุ่มเดียวกันเรียงตามรางวัล ไม่ปล่อยตามลำดับที่ฐานข้อมูลคืนมา
      for (const session of sessions) {
        session.certificates.sort((a, b) => a.order - b.order);
      }
      return {
        code,
        name: program.name,
        latestYear: Math.max(...sessions.map((s) => s.year)),
        sessions,
      };
    })
    // รายการสอบที่มีผลล่าสุดอยู่บนสุด — ผู้ปกครองเข้ามาเพราะเพิ่งรู้ว่าผลรอบใหม่ออก
    // ไม่ใช่เพราะอยากไล่ดูของเก่า ถ้าเรียงตามตัวอักษรของรหัส ของใหม่จะไปจมอยู่ล่าง
    // ปีเท่ากันค่อยเรียงตามรหัส เพื่อให้ลำดับนิ่งทุกครั้งที่โหลด
    .sort((a, b) => b.latestYear - a.latestYear || a.code.localeCompare(b.code));

  return {
    studentId: student.id,
    nameTh: student.nameTh,
    nameEn: student.nameEn,
    school: student.school,
    // ใบล่าสุดคือใบแรกสุดตามลำดับที่จัดไว้แล้ว
    latestLevel: programs[0]?.sessions[0]?.certificates[0]?.level ?? null,
    programs,
  };
}

/** ปีใหม่อยู่บน ปีเดียวกันเรียงตามลำดับรอบ — ต้องนิ่ง ไม่ปล่อยให้ขึ้นกับลำดับที่ฐานข้อมูลคืนมา */
function bySession(a: ExamSession, b: ExamSession): number {
  return b.year - a.year || roundRank(a.round) - roundRank(b.round);
}

/** ชื่อที่ตรงเป๊ะต้องมาก่อนชื่อที่แค่มีคำค้นอยู่ข้างใน */
function byRelevance(q: string) {
  const score = (r: SearchResult) => {
    const name = normalizeName(r.nameEn);
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    return 2;
  };
  return (a: SearchResult, b: SearchResult) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return (a.nameEn ?? "").localeCompare(b.nameEn ?? "");
  };
}
