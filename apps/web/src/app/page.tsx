import { headers } from "next/headers";
import { CertificateCard } from "@/components/CertificateCard";
import { SearchBox } from "@/components/SearchBox";
import { MIN_QUERY_LENGTH } from "@/lib/constants";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { searchStudents, type SearchResult } from "@/lib/search";

// ผลค้นหาเปลี่ยนตามฐานข้อมูล ห้าม cache
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  let results: SearchResult[] = [];
  let rateLimited = false;

  if (query.length >= MIN_QUERY_LENGTH) {
    const limit = checkRateLimit(clientIp(await headers()));
    if (limit.ok) results = await searchStudents(query);
    else rateLimited = true;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-brand)] sm:text-3xl">
          ค้นหาเกียรติบัตร
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600 sm:text-base">
          พิมพ์ชื่อ-นามสกุลของผู้เข้าสอบ ได้ทั้งภาษาไทยและภาษาอังกฤษ
          ระบบจะแสดงเกียรติบัตรทุกใบของบุคคลนั้น
        </p>
      </header>

      <div className="mx-auto max-w-2xl">
        <SearchBox defaultValue={query} />
      </div>

      <section className="mt-10">
        {rateLimited ? (
          <Notice tone="warn">
            ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง
          </Notice>
        ) : query.length === 0 ? (
          <Notice tone="muted">
            เริ่มต้นด้วยการพิมพ์ชื่อในช่องด้านบน
          </Notice>
        ) : query.length < MIN_QUERY_LENGTH ? (
          <Notice tone="warn">
            กรุณาพิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษร
          </Notice>
        ) : results.length === 0 ? (
          <Notice tone="muted">
            <span className="font-medium">ไม่พบเกียรติบัตรของ &ldquo;{query}&rdquo;</span>
            <br />
            ลองตรวจตัวสะกดอีกครั้ง หรือพิมพ์เฉพาะชื่อต้นโดยไม่ใส่นามสกุล
            <br />
            หากยังไม่พบ อาจเป็นเพราะเจ้าหน้าที่ยังไม่ได้นำเข้าเกียรติบัตรรอบนั้น
          </Notice>
        ) : (
          <div className="space-y-10">
            <p className="text-sm text-gray-500">
              พบ {results.length} รายชื่อที่ตรงกับ &ldquo;{query}&rdquo;
            </p>
            {results.map((student) => (
              <StudentBlock key={student.studentId} student={student} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function StudentBlock({ student }: { student: SearchResult }) {
  const displayName = student.nameTh ?? student.nameEn ?? "ไม่ระบุชื่อ";
  const total = student.programs.reduce(
    (sum, p) => sum + p.years.reduce((n, y) => n + y.certificates.length, 0),
    0,
  );

  return (
    <article>
      <div className="mb-5 border-b border-gray-200 pb-3">
        <h2 className="text-xl font-bold">{displayName}</h2>
        {student.nameEn && student.nameTh && (
          <p className="text-sm text-gray-500">{student.nameEn}</p>
        )}
        {/* โรงเรียนต้องแสดงเสมอ เพราะคนชื่อพ้องกันมีจริง
            ถ้าไม่บอก ผู้ปกครองจะแยกไม่ออกว่ารายการไหนของลูกตัวเอง */}
        {student.school && (
          <p className="mt-1 text-sm font-medium text-[var(--color-gold)]">{student.school}</p>
        )}
        <p className="mt-1 text-sm text-gray-500">ทั้งหมด {total} ใบ</p>
      </div>

      {/* จัดกลุ่มตามรายการสอบก่อน แล้วค่อยแยกปีข้างใน
          เพราะผู้ปกครองมักนึกถึง "HKIMO ของลูก" ก่อน แล้วจึงค่อยเลือกปี */}
      <div className="space-y-8">
        {student.programs.map((program) => (
          <section key={program.code}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-lg font-semibold text-[var(--color-brand)]">{program.code}</h3>
              <span className="text-sm text-gray-500">{program.name}</span>
            </div>

            <div className="space-y-5 border-l-2 border-[var(--color-gold)]/30 pl-4">
              {program.years.map((year) => (
                <div key={year.academicYear}>
                  <h4 className="mb-3 text-sm font-semibold text-[var(--color-gold)]">
                    ปีการศึกษา {year.academicYear}
                  </h4>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {year.certificates.map((cert) => (
                      <CertificateCard
                        key={cert.id}
                        cert={cert}
                        programCode={program.code}
                        studentName={displayName}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function Notice({ tone, children }: { tone: "muted" | "warn"; children: React.ReactNode }) {
  const styles =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-gray-200 bg-white text-gray-600";
  return (
    <div className={`rounded-xl border px-5 py-8 text-center leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}
