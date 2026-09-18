import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { BatchWorkflow, type PublishState } from "@/components/admin/BatchWorkflow";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { DangerZone } from "@/components/admin/DangerZone";
import { RetentionPanel } from "@/components/admin/RetentionPanel";
import { SourcesPanel } from "@/components/admin/SourcesPanel";
import { DuplicateReview, type DuplicateGroup } from "@/components/admin/DuplicateReview";
import { MissingList } from "@/components/admin/MissingList";
import { MatchTable } from "@/components/admin/MatchTable";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { batchConfirmPhrase } from "@/lib/batch-delete";
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

  const deleteInfo = await loadDeleteInfo(id, batch.examId);
  const retention = await loadRetention(id);
  // เหตุผลที่ยังเคลียร์ไฟล์ต้นฉบับไม่ได้ อ่านจากผลตรวจครั้งล่าสุดของ worker
  // ไม่คำนวณซ้ำฝั่งนี้ เพราะถ้าสองฝั่งคิดไม่ตรงกัน แอดมินจะเห็นเหตุผลที่ไม่ตรงกับความจริง
  const lastCleanup = await prisma.job.findFirst({
    where: { batchId: id, type: "CLEANUP_SOURCES", status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { progress: true },
  });
  const blockers = readBlockers(lastCleanup?.progress);

  const roundLabel = batch.exam.round === "HEAT" ? "รอบคัดเลือก" : "รอบชิงชนะเลิศ";

  return (
    <AdminShell
      title={`${batch.exam.program.code} ${roundLabel} ${batch.exam.year}`}
      back={{ href: "/admin", label: "กลับหน้ารวม" }}
    >
      <div className="-mt-4 mb-6 space-y-1 text-sm text-ink-soft">
        <p className="flex flex-wrap items-center gap-2">
          <StatusBadge status={batch.status} />
          <span>{batch.exam.program.name}</span>
          <span>· สร้างเมื่อ {batch.createdAt.toLocaleDateString("th-TH")}</span>
        </p>
        <p>
          ไฟล์ที่ตัดได้จะชื่อ{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 text-xs">
            {"{FNAME}_{LNAME}_"}
            {batch.exam.program.code}_{batch.exam.round}_{"{AWARD}_"}
            {batch.exam.year}.pdf
          </code>
        </p>
      </div>

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
                // เอาเฉพาะบรรทัดแรก ส่วนที่เหลือเป็น traceback สำหรับคนแก้โค้ด ไม่ใช่สำหรับแอดมิน
                error: batch.jobs[0].error?.split("\n")[0] ?? null,
                userError: batch.jobs[0].userError,
              }
            : null
        }
      />

      <MissingList batchId={id} items={missingItems} />

      <DuplicateReview groups={duplicateGroups} />

      <section className="mt-10">
        <h2 className="mb-1 font-semibold">หน้าที่ยังจับคู่ไม่ได้ ({pending.length})</h2>
        <p className="mb-4 text-sm text-ink-soft">
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

      <section className="mt-10">
        <h2 className="mb-2 font-semibold">อายุการเก็บ</h2>
        <RetentionPanel
          batchId={id}
          expiresAt={retention.expiresAt?.toISOString() ?? null}
          certificates={batch._count.certificates}
          deletedFiles={retention.deletedFiles}
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 font-semibold">ไฟล์ต้นฉบับ</h2>
        <SourcesPanel
          batchId={id}
          clearedAt={batch.sourcesClearedAt?.toISOString() ?? null}
          blockers={blockers}
        />
      </section>

      <DangerZone
        batchId={id}
        confirmPhrase={batchConfirmPhrase(batch.exam.program.code, batch.exam.round, batch.exam.year)}
        published={batch.status === "PUBLISHED"}
        counts={deleteInfo.counts}
        siblingBatches={deleteInfo.siblingBatches}
      />
    </AdminShell>
  );
}

/** ตัวเลขที่ต้องบอกแอดมินก่อนกดลบ — ต้องรู้ว่าจะหายไปแค่ไหนก่อนตัดสินใจ */
async function loadDeleteInfo(batchId: string, examId: string) {
  const [certificates, pages, siblingBatches, students] = await Promise.all([
    prisma.certificate.count({ where: { batchId } }),
    prisma.stagingPage.count({ where: { batchId } }),
    prisma.batch.count({ where: { examId, id: { not: batchId } } }),
    // ผู้เข้าสอบที่จะไม่เหลืออะไรเลยหลังลบรอบนี้
    // (ยังมีใบจากรอบอื่น หรือมีหน้าในรอบอื่นชี้มาหา = ไม่ถูกลบ)
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT c.student_id) AS count
      FROM certificates c
      WHERE c.batch_id = ${batchId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM certificates o
          WHERE o.student_id = c.student_id AND o.batch_id <> ${batchId}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM staging_pages sp
          WHERE sp.matched_student_id = c.student_id AND sp.batch_id <> ${batchId}::uuid)`,
  ]);

  return {
    counts: { certificates, pages, students: Number(students[0]?.count ?? 0) },
    siblingBatches,
  };
}

/** วันหมดอายุที่เร็วที่สุดของรอบ และจำนวนใบที่ไฟล์ถูกลบไปแล้ว */
async function loadRetention(batchId: string) {
  const [soonest, deletedFiles] = await Promise.all([
    prisma.certificate.findFirst({
      where: { batchId, expiresAt: { not: null }, filesDeletedAt: null },
      orderBy: { expiresAt: "asc" },
      select: { expiresAt: true },
    }),
    prisma.certificate.count({ where: { batchId, filesDeletedAt: { not: null } } }),
  ]);
  return { expiresAt: soonest?.expiresAt ?? null, deletedFiles };
}

function readBlockers(progress: unknown): string[] | null {
  const list = (progress as { blockers?: unknown } | null | undefined)?.blockers;
  if (!Array.isArray(list)) return null;
  return list.filter((item): item is string => typeof item === "string");
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
