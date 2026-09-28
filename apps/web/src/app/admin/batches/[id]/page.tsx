import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { BatchWorkflow } from "@/components/admin/BatchWorkflow";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { batchConfirmPhrase } from "@/lib/batch-delete";
import { loadBatchView } from "@/lib/batch-view";
import { allowsLevelSubfolder } from "@/lib/certificate-catalog";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) redirect("/admin/login");

  const { id } = await params;
  const view = await loadBatchView(id);
  if (!view) notFound();
  const { batch } = view;

  const exam = await prisma.batch.findUniqueOrThrow({ where: { id }, select: { examId: true } });
  const deleteInfo = await loadDeleteInfo(id, exam.examId);
  const retention = await loadRetention(id);
  // เหตุผลที่ยังเคลียร์ไฟล์ต้นฉบับไม่ได้ อ่านจากผลตรวจครั้งล่าสุดของ worker
  // ไม่คำนวณซ้ำฝั่งนี้ เพราะถ้าสองฝั่งคิดไม่ตรงกัน แอดมินจะเห็นเหตุผลที่ไม่ตรงกับความจริง
  const lastCleanup = await prisma.job.findFirst({
    where: { batchId: id, type: "CLEANUP_SOURCES", status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { progress: true },
  });
  const blockers = readBlockers(lastCleanup?.progress);

  const roundLabel = batch.round === "HEAT" ? "รอบคัดเลือก" : "รอบชิงชนะเลิศ";

  return (
    <AdminShell
      title="นำเข้าเกียรติบัตร"
      description={`${batch.programCode} · ${roundLabel} · ${batch.year} — ตรวจข้อมูลก่อนเผยแพร่ให้ผู้ปกครองค้นหา`}
      back={{ href: "/admin", label: "กลับหน้ารวม" }}
      intakeWidth
    >
      <div className="-mt-4 mb-6 text-sm text-ink-soft">
        <p className="flex flex-wrap items-center gap-2">
          <StatusBadge status={batch.status} />
          <span>{batch.programName}</span>
          <span>· สร้างเมื่อ {new Date(batch.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}</span>
        </p>
      </div>

      <BatchWorkflow
        view={view}
        levelSubfolder={allowsLevelSubfolder(batch.programCode, batch.round)}
        deleteInfo={{
          confirmPhrase: batchConfirmPhrase(batch.programCode, batch.round, batch.year),
          counts: deleteInfo.counts,
          siblingBatches: deleteInfo.siblingBatches,
        }}
        retention={{
          expiresAt: retention.expiresAt?.toISOString() ?? null,
          deletedFiles: retention.deletedFiles,
        }}
        blockers={blockers}
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
    // (ยังมีใบจากรอบอื่น หรือมีหน้า/รายชื่อในรอบอื่นชี้มาหา = ไม่ถูกลบ)
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT c.student_id) AS count
      FROM certificates c
      WHERE c.batch_id = ${batchId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM certificates o
          WHERE o.student_id = c.student_id AND o.batch_id <> ${batchId}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM staging_pages sp
          WHERE sp.matched_student_id = c.student_id AND sp.batch_id <> ${batchId}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM roster_entries re
          WHERE re.student_id = c.student_id AND re.batch_id <> ${batchId}::uuid)`,
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
