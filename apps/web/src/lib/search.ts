/** ตรรกะการค้นหาของหน้าสาธารณะ */
import { MIN_QUERY_LENGTH } from "./constants";
import { prisma } from "./db";
import { normalizeName } from "./normalize";
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
  award: string;
  level: string | null;
  certNo: string | null;
  previewUrl: string | null;
};

export type ProgramGroup = {
  code: string;
  name: string;
  /** ปีล่าสุดอยู่บนสุด */
  years: { year: number; certificates: CertificateItem[] }[];
};

export type SearchResult = {
  studentId: string;
  nameTh: string | null;
  nameEn: string | null;
  /** แสดงคู่กับชื่อเสมอ เพราะคนชื่อพ้องกันมีจริง ผู้ปกครองต้องดูออกว่าใบไหนของลูกตัวเอง */
  school: string | null;
  /** จัดกลุ่มตามรายการสอบก่อน แล้วค่อยแยกปีข้างใน */
  programs: ProgramGroup[];
};

export async function searchStudents(rawQuery: string): Promise<SearchResult[]> {
  const q = normalizeName(rawQuery);
  if (q.length < MIN_QUERY_LENGTH) return [];

  const students = await prisma.student.findMany({
    where: {
      // ต้องมีเกียรติบัตรที่ publish แล้วอย่างน้อย 1 ใบ ไม่งั้นไม่ต้องโผล่มา
      certificates: { some: { published: { not: null } } },
      OR: [{ nameEnNormalized: { contains: q } }, { nameThNormalized: { contains: q } }],
    },
    take: MAX_STUDENTS,
    include: {
      certificates: {
        where: { published: { not: null } },
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
  level: string | null;
  certNo: string | null;
  previewKey: string | null;
  exam: { year: number; round: string; program: { code: string; name: string } };
};

function toSearchResult(student: {
  id: string;
  nameTh: string | null;
  nameEn: string | null;
  school: string | null;
  certificates: CertificateRow[];
}): SearchResult {
  // code -> ปีการศึกษา -> เกียรติบัตร
  const byProgram = new Map<string, { name: string; years: Map<number, CertificateItem[]> }>();

  for (const cert of student.certificates) {
    const { code, name } = cert.exam.program;
    const program = byProgram.get(code) ?? { name, years: new Map() };
    byProgram.set(code, program);

    const year = cert.exam.year;
    const bucket = program.years.get(year) ?? [];
    bucket.push({
      id: cert.id,
      year,
      round: cert.exam.round,
      award: cert.award,
      level: cert.level,
      certNo: cert.certNo,
      previewUrl: cert.previewKey ? publicUrl(cert.previewKey) : null,
    });
    program.years.set(year, bucket);
  }

  return {
    studentId: student.id,
    nameTh: student.nameTh,
    nameEn: student.nameEn,
    school: student.school,
    programs: [...byProgram.entries()]
      .map(([code, program]) => ({
        code,
        name: program.name,
        years: [...program.years.entries()]
          .map(([year, certificates]) => ({ year, certificates }))
          .sort((a, b) => b.year - a.year),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** ชื่อที่ตรงเป๊ะต้องมาก่อนชื่อที่แค่มีคำค้นอยู่ข้างใน */
function byRelevance(q: string) {
  const score = (r: SearchResult) => {
    const names = [normalizeName(r.nameTh), normalizeName(r.nameEn)].filter(Boolean);
    if (names.some((n) => n === q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    return 2;
  };
  return (a: SearchResult, b: SearchResult) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return (a.nameTh ?? a.nameEn ?? "").localeCompare(b.nameTh ?? b.nameEn ?? "", "th");
  };
}
