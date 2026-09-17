import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BatchWorkflow, type PublishState } from "@/components/admin/BatchWorkflow";
import { DuplicateReview, type DuplicateGroup } from "@/components/admin/DuplicateReview";
import { MissingList } from "@/components/admin/MissingList";
import { MatchTable } from "@/components/admin/MatchTable";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadMissingItems } from "@/lib/missing";
import { decidePublish, needsPolicyDecision, PERFECT_SCORE } from "@/lib/publish";
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
  const publishState = await loadPublishState(id, batch.multiAwardPolicy);
  const missingItems = await loadMissingItems(id);

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
          รอบ {batch.exam.round === "HEAT" ? "Heat (คัดเลือก)" : "Final (ชิงชนะเลิศ)"} · ปี{" "}
          {batch.exam.year} · สร้างเมื่อ {batch.createdAt.toLocaleDateString("th-TH")}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          ไฟล์ที่ตัดได้จะชื่อ{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
            {"{FNAME}_{LNAME}_"}
            {batch.exam.program.code}_{batch.exam.round}_{"{AWARD}_"}
            {batch.exam.year}.pdf
          </code>
        </p>
      </header>

      <BatchWorkflow
        batchId={batch.id}
        status={batch.status}
        hasZip={Boolean(batch.sourceZipKey)}
        hasExcel={Boolean(batch.sourceExcelKey)}
        certificateCount={batch._count.certificates}
        stats={batch.stats as Record<string, unknown>}
        counts={Object.fromEntries(counts.map((c) => [c.matchStatus, c._count]))}
        publishState={publishState}
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

      <MissingList batchId={id} items={missingItems} />

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
            award: page.award,
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
      award: page.award,
      rosterAward: page.rosterAward,
      isMatched: page.matchStatus === "MATCHED",
      studentNameTh: page.matchedStudent?.nameTh ?? null,
      studentNameEn: page.matchedStudent?.nameEn ?? null,
      studentSchool: page.matchedStudent?.school ?? null,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * สรุปสถานะการเผยแพร่ให้หน้าเว็บแสดง
 *
 * ใช้ตรรกะเดียวกับตอนกดเผยแพร่จริง (src/lib/publish.ts) เพื่อให้สิ่งที่แอดมินเห็น
 * ตรงกับสิ่งที่จะเกิดขึ้นจริงเสมอ ไม่ใช่คำนวณคนละแบบแล้วเหลื่อมกัน
 */
async function loadPublishState(
  batchId: string,
  policy: PublishState["policy"],
): Promise<PublishState> {
  const certificates = await prisma.certificate.findMany({
    where: { batchId },
    select: {
      id: true,
      award: true,
      certNo: true,
      published: true,
      studentId: true,
      student: { select: { nameEn: true, nameTh: true } },
    },
    orderBy: { pageNumber: "asc" },
  });

  const byStudent = new Map<string, typeof certificates>();
  for (const c of certificates) {
    byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c]);
  }

  const people = [...byStudent.entries()].map(([studentId, certs]) => ({
    studentId,
    certificates: certs.map((c) => ({ id: c.id, award: c.award })),
  }));

  const decision = decidePublish(people, policy);
  const publishedIds = new Set(certificates.filter((c) => c.published).map((c) => c.id));
  const nameOf = (studentId: string) => {
    const first = byStudent.get(studentId)?.[0];
    return first?.student.nameEn ?? first?.student.nameTh ?? "ไม่ระบุชื่อ";
  };

  return {
    policy,
    needsDecision: needsPolicyDecision(people),
    publishedCount: publishedIds.size,
    held: decision.heldStudents.map((h) => ({
      name: nameOf(h.studentId),
      certNo: byStudent.get(h.studentId)?.[0]?.certNo ?? null,
      reason: h.reason,
    })),
    multiAward: people
      .filter(
        (p) =>
          p.certificates.some((c) => c.award === PERFECT_SCORE) &&
          p.certificates.some((c) => c.award !== PERFECT_SCORE),
      )
      .map((p) => ({ name: nameOf(p.studentId), awards: p.certificates.map((c) => c.award) })),
    // ข้อมูลครบแล้วแต่ยังไม่ถูกเผยแพร่ — เกิดหลังเติมไฟล์ที่ตกหล่นเข้ารอบที่เผยแพร่ไปแล้ว
    readyToPublish: decision.publish.filter((certId) => !publishedIds.has(certId)).length,
  };
}
