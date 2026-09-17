import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { NewBatchForm } from "@/components/admin/NewBatchForm";
import { ProgramManager } from "@/components/admin/ProgramManager";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  DRAFT: { text: "ยังไม่อัปโหลดไฟล์", className: "bg-gray-100 text-gray-600" },
  SPLITTING: { text: "กำลังตัดแยกหน้า", className: "bg-blue-100 text-blue-700" },
  SPLIT_DONE: { text: "ตัดเสร็จ รอรายชื่อ", className: "bg-indigo-100 text-indigo-700" },
  MATCHING: { text: "กำลังจับคู่รายชื่อ", className: "bg-blue-100 text-blue-700" },
  READY: { text: "รอตรวจและเผยแพร่", className: "bg-amber-100 text-amber-800" },
  PUBLISHED: { text: "เผยแพร่แล้ว", className: "bg-green-100 text-green-700" },
  FAILED: { text: "ล้มเหลว", className: "bg-red-100 text-red-700" },
};

export default async function AdminDashboard() {
  if (!(await isAuthenticated())) redirect("/admin/login?next=/admin");

  const [batches, programRows] = await Promise.all([
    prisma.batch.findMany({
      include: {
        exam: { include: { program: true } },
        _count: { select: { certificates: true, stagingPages: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.examProgram.findMany({
      orderBy: [{ active: "desc" }, { code: "asc" }],
      include: { _count: { select: { exams: true } } },
    }),
  ]);

  const programs = programRows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    kind: p.kind,
    active: p.active,
    examCount: p._count.exams,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-brand)]">ระบบนำเข้าเกียรติบัตร</h1>
          <p className="mt-1 text-sm text-gray-500">
            อัปโหลดไฟล์รวมเล่ม ตัดแยกหน้า จับคู่รายชื่อ แล้วเผยแพร่
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-gray-500 underline">
            ดูหน้าค้นหา
          </Link>
          <LogoutButton />
        </div>
      </header>

      <div className="mb-10 space-y-6">
        <ProgramManager programs={programs} />

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 font-semibold">สร้างรอบการนำเข้าใหม่</h2>
          <NewBatchForm programs={programs} />
        </section>
      </div>

      <section>
        <h2 className="mb-4 font-semibold">รอบการนำเข้าทั้งหมด</h2>
        {batches.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-5 py-8 text-center text-gray-500">
            ยังไม่มีรอบการนำเข้า เริ่มจากแบบฟอร์มด้านบน
          </p>
        ) : (
          <ul className="space-y-3">
            {batches.map((batch) => {
              const status = STATUS_LABEL[batch.status] ?? {
                text: batch.status,
                className: "bg-gray-100",
              };
              return (
                <li key={batch.id}>
                  <Link
                    href={`/admin/batches/${batch.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border
                               border-gray-200 bg-white px-5 py-4 transition hover:border-[var(--color-brand)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <code className="mr-2 rounded bg-[var(--color-brand-soft)] px-1.5 py-0.5 text-sm text-[var(--color-brand)]">
                          {batch.exam.program.code}
                        </code>
                        {batch.exam.program.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        ปีการศึกษา {batch.exam.academicYear} ·{" "}
                        {batch.exam.program.kind === "DOMESTIC" ? "เฉพาะของไทย" : "รวมประเทศ"} ·{" "}
                        {batch._count.stagingPages} หน้า / {batch._count.certificates} ใบ
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.className}`}>
                      {status.text}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
