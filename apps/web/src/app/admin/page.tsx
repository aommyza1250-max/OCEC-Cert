import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { ExpiringSoon, type ExpiringGroup } from "@/components/admin/ExpiringSoon";
import { ProgramManager } from "@/components/admin/ProgramManager";
import { statusLabel } from "@/components/admin/StatusBadge";
import { YearGrid, type GridRow } from "@/components/admin/YearGrid";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROUND_LABEL: Record<string, string> = { HEAT: "รอบคัดเลือก", FINAL: "รอบชิงชนะเลิศ" };

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/admin/login?next=/admin");

  const thisYear = new Date().getFullYear();
  const { year } = await searchParams;
  const selectedYear = Number(year) || thisYear;

  // ดึงรอบนำเข้าทั้งหมด แต่เอาเฉพาะคอลัมน์ที่ใช้จริง
  // (เดิมดึงแบบ take: 50 ซึ่งพอถึงปีที่ 5 รอบเก่าจะหายจากหน้าจอโดยไม่มีอะไรบอก)
  const [batchRows, programRows, certCounts] = await Promise.all([
    prisma.batch.findMany({
      select: {
        id: true,
        status: true,
        createdAt: true,
        exam: { select: { round: true, year: true, programId: true, program: { select: { code: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.examProgram.findMany({
      orderBy: [{ active: "desc" }, { code: "asc" }],
      include: { _count: { select: { exams: true } } },
    }),
    prisma.certificate.groupBy({ by: ["batchId"], _count: true }),
  ]);

  const certificatesOf = new Map(certCounts.map((c) => [c.batchId, c._count]));
  const programs = programRows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    active: p.active,
    examCount: p._count.exams,
  }));

  const rows: GridRow[] = programs
    .filter((p) => p.active)
    .map((program) => {
      const cellOf = (round: "HEAT" | "FINAL") => {
        const matches = batchRows.filter(
          (b) =>
            b.exam.programId === program.id &&
            b.exam.round === round &&
            b.exam.year === selectedYear,
        );
        const first = matches[0];
        return {
          batchId: first?.id ?? null,
          status: first?.status ?? null,
          certificates: first ? (certificatesOf.get(first.id) ?? 0) : 0,
          extras: Math.max(0, matches.length - 1),
        };
      };
      return {
        programId: program.id,
        code: program.code,
        name: program.name,
        cells: { HEAT: cellOf("HEAT"), FINAL: cellOf("FINAL") },
      };
    });

  const publishedThisYear = rows.reduce(
    (n, row) =>
      n +
      (row.cells.HEAT.status === "PUBLISHED" ? 1 : 0) +
      (row.cells.FINAL.status === "PUBLISHED" ? 1 : 0),
    0,
  );

  // ปีที่เลือกได้ = ปีที่มีข้อมูล + ปีนี้ + ปีหน้า (เผื่อเริ่มนำเข้าก่อนขึ้นปีใหม่)
  const years = [...new Set([...batchRows.map((b) => b.exam.year), thisYear, thisYear + 1])].sort(
    (a, b) => b - a,
  );

  const expiringSoon = await loadExpiringSoon(batchRows);

  const archive = [...new Set(batchRows.map((b) => b.exam.year))]
    .filter((y) => y !== selectedYear)
    .sort((a, b) => b - a)
    .map((y) => {
      const items = batchRows.filter((b) => b.exam.year === y);
      return {
        year: y,
        published: items.filter((b) => b.status === "PUBLISHED").length,
        certificates: items.reduce((n, b) => n + (certificatesOf.get(b.id) ?? 0), 0),
        items,
      };
    });

  return (
    <AdminShell
      title="รอบการนำเข้า"
      description="อัปโหลดไฟล์รวมเล่ม ตัดแยกหน้า จับคู่รายชื่อ แล้วเผยแพร่"
    >
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-soft">ปี</span>
            {years.map((y) => (
              <Link
                key={y}
                href={`/admin?year=${y}`}
                className={`rounded-lg px-3 py-1 text-sm transition ${
                  y === selectedYear
                    ? "bg-brand font-medium text-white"
                    : "border border-hairline bg-card text-ink-soft hover:border-brand"
                }`}
              >
                {y}
              </Link>
            ))}
          </div>
          <p className="text-sm text-ink-soft">
            เผยแพร่แล้ว {publishedThisYear}/{rows.length * 2} ช่อง
          </p>
        </div>

        <YearGrid year={selectedYear} rows={rows} />
      </section>

      <ExpiringSoon groups={expiringSoon} />

      {archive.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold">ปีก่อนหน้า</h2>
          <div className="space-y-2">
            {archive.map((group) => (
              <details key={group.year} className="rounded-2xl border border-hairline bg-card">
                <summary className="cursor-pointer px-5 py-3 text-sm">
                  <span className="font-medium">ปี {group.year}</span>
                  <span className="ml-2 text-ink-soft">
                    เผยแพร่แล้ว {group.published} รอบ · {group.certificates} ใบ
                  </span>
                </summary>
                <ul className="border-t border-hairline">
                  {group.items.map((batch) => (
                    <li key={batch.id} className="border-b border-gray-50 last:border-0">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm
                                   transition hover:bg-paper"
                      >
                        <span>
                          <code className="mr-2 rounded bg-brand-soft px-1.5 py-0.5 text-brand">
                            {batch.exam.program.code}
                          </code>
                          {ROUND_LABEL[batch.exam.round] ?? batch.exam.round}
                        </span>
                        <span className="text-ink-soft">
                          {certificatesOf.get(batch.id) ?? 0} ใบ · {statusLabel(batch.status)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* ใช้ปีละครั้งสองครั้ง จึงพับไว้ ไม่ต้องกินที่ด้านบนตลอดเวลา */}
      <details className="mt-8 rounded-2xl border border-hairline bg-card">
        <summary className="cursor-pointer px-5 py-3 font-semibold">จัดการรายการสอบ</summary>
        <div className="border-t border-hairline p-5">
          <ProgramManager programs={programs} />
        </div>
      </details>
    </AdminShell>
  );
}

/** รอบที่มีเกียรติบัตรใกล้ครบอายุการเก็บใน 30 วัน */
async function loadExpiringSoon(
  batches: { id: string; exam: { round: string; year: number; program: { code: string } } }[],
): Promise<ExpiringGroup[]> {
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);

  const rows = await prisma.certificate.groupBy({
    by: ["batchId"],
    where: { expiresAt: { not: null, lte: soon }, filesDeletedAt: null },
    _count: true,
    _min: { expiresAt: true },
  });

  return rows
    .map((row) => {
      const batch = batches.find((b) => b.id === row.batchId);
      const expiresAt = row._min.expiresAt;
      if (!batch || !expiresAt) return null;
      return {
        batchId: row.batchId,
        label: `${batch.exam.program.code} ${ROUND_LABEL[batch.exam.round] ?? batch.exam.round} ${batch.exam.year}`,
        count: row._count,
        expiresAt: expiresAt.toISOString(),
      };
    })
    .filter((row): row is ExpiringGroup => row !== null)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}
