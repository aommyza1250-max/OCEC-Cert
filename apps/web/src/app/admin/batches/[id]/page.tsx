import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BatchWorkflow } from "@/components/admin/BatchWorkflow";
import { DuplicateReview, type DuplicateGroup } from "@/components/admin/DuplicateReview";
import { MatchTable } from "@/components/admin/MatchTable";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) redirect("/admin/login");

  const { id } = await params;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      exam: { include: { program: true } },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { certificates: true } },
    },
  });
  if (!batch) notFound();

  // แสดงเฉพาะหน้าที่ยังต้องจัดการ — หน้าที่จับคู่แล้วไม่ต้องให้แอดมินไล่ดูทั้งหมด
  const pending = await prisma.stagingPage.findMany({
    where: { batchId: id, matchStatus: { in: ["UNMATCHED", "AMBIGUOUS"] } },
    orderBy: { pageNumber: "asc" },
    take: 200,
  });

  const duplicateGroups = await loadDuplicateGroups(id);

  const counts = await prisma.stagingPage.groupBy({
    by: ["matchStatus"],
    where: { batchId: id },
    _count: true,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/admin" className="text-sm text-gray-500 underline">
        ← กลับหน้ารวม
      </Link>

      <header className="mb-8 mt-3">
        <h1 className="text-2xl font-bold text-[var(--color-brand)]">
          <code className="mr-2 rounded bg-[var(--color-brand-soft)] px-2 py-1 text-xl">
            {batch.exam.program.code}
          </code>
          {batch.exam.program.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          ปีการศึกษา {batch.exam.academicYear} ·{" "}
          {batch.exam.program.kind === "DOMESTIC" ? "เฉพาะของไทย" : "รวมประเทศ"} · สร้างเมื่อ{" "}
          {batch.createdAt.toLocaleDateString("th-TH")}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          ไฟล์ที่ตัดได้จะชื่อ{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
            {"{FNAME}_{LNAME}_"}
            {batch.exam.program.code}.pdf
          </code>
        </p>
      </header>

      <BatchWorkflow
        batchId={batch.id}
        status={batch.status}
        hasPdf={Boolean(batch.sourcePdfKey)}
        hasExcel={Boolean(batch.sourceExcelKey)}
        certificateCount={batch._count.certificates}
        stats={batch.stats as Record<string, unknown>}
        counts={Object.fromEntries(counts.map((c) => [c.matchStatus, c._count]))}
        latestJob={
          batch.jobs[0]
            ? {
                id: batch.jobs[0].id,
                type: batch.jobs[0].type,
                status: batch.jobs[0].status,
                error: batch.jobs[0].error,
              }
            : null
        }
      />

      <DuplicateReview groups={duplicateGroups} />

      <section className="mt-10">
        <h2 className="mb-1 font-semibold">หน้าที่ยังจับคู่ไม่ได้ ({pending.length})</h2>
        <p className="mb-4 text-sm text-gray-500">
          ระบบไม่เดาให้เมื่อไม่มั่นใจ กรอกชื่อให้ตรงกับที่ปรากฏบนเกียรติบัตรเพื่อจับคู่ด้วยมือ
        </p>
        <MatchTable
          pages={pending.map((page) => ({
            id: page.id,
            pageNumber: page.pageNumber,
            extractedName: page.extractedName,
            certNo: page.certNo,
            level: page.level,
            matchStatus: page.matchStatus,
            matchNote: page.matchNote,
            previewUrl: page.previewKey ? publicUrl(page.previewKey) : null,
            rawTextExcerpt: page.rawText.slice(0, 300),
          }))}
        />
      </section>
    </main>
  );
}

/**
 * รวมหน้าที่ชื่อซ้ำกันไว้เป็นกลุ่มเดียว โดยดึงใบที่จับคู่ไปแล้วมาแสดงคู่กันด้วย
 * แอดมินจะได้เห็นเกียรติบัตรจริงทั้งสองใบพร้อมกันก่อนตัดสิน
 */
async function loadDuplicateGroups(batchId: string): Promise<DuplicateGroup[]> {
  const conflicts = await prisma.stagingPage.findMany({
    where: { batchId, matchStatus: "DUPLICATE_NAME" },
    orderBy: { pageNumber: "asc" },
  });
  if (conflicts.length === 0) return [];

  const names = [
    ...new Set(conflicts.map((p) => p.extractedNameNormalized).filter(Boolean)),
  ] as string[];

  const related = await prisma.stagingPage.findMany({
    where: {
      batchId,
      extractedNameNormalized: { in: names },
      matchStatus: { in: ["MATCHED", "DUPLICATE_NAME"] },
    },
    include: { matchedStudent: true },
    orderBy: { pageNumber: "asc" },
  });

  const groups = new Map<string, DuplicateGroup>();
  for (const page of related) {
    const key = page.extractedNameNormalized!;
    const group = groups.get(key) ?? { name: page.extractedName ?? key, pages: [] };
    group.pages.push({
      id: page.id,
      pageNumber: page.pageNumber,
      extractedName: page.extractedName,
      certNo: page.certNo,
      level: page.level,
      previewUrl: page.previewKey ? publicUrl(page.previewKey) : null,
      matchNote: page.matchNote,
      pendingAward: page.pendingAward,
      pendingSchool: page.pendingSchool,
      isMatched: page.matchStatus === "MATCHED",
      studentNameTh: page.matchedStudent?.nameTh ?? null,
      studentNameEn: page.matchedStudent?.nameEn ?? null,
      studentSchool: page.matchedStudent?.school ?? null,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}
