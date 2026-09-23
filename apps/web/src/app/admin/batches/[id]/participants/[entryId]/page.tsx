import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AuditTrail } from "@/components/admin/AuditTrail";
import { CertificateManager, type ParticipantPage } from "@/components/admin/CertificateManager";
import { IdentityPanel, type StudentCandidate } from "@/components/admin/IdentityPanel";
import { ParticipantEditor } from "@/components/admin/ParticipantEditor";
import { ModeBadge } from "@/components/admin/StatusBadge";
import { isAuthenticated } from "@/lib/auth";
import { INTAKE_JOBS } from "@/lib/batch-guard";
import { awardCatalog, awardDisplay } from "@/lib/certificate-catalog";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * รายละเอียดผู้เข้าสอบ 1 คน — ข้อมูลการสอบแยกจากเกียรติบัตรชัดเจน
 * พร้อมประวัติการแก้ไขทั้งหมดของคนนี้ (อะไรเปลี่ยนจากอะไรเป็นอะไร เมื่อไหร่ จาก session ไหน)
 */
export default async function ParticipantPage({ params }: { params: Promise<{ id: string; entryId: string }> }) {
  if (!(await isAuthenticated())) redirect("/admin/login");
  const { id, entryId } = await params;

  const entry = await prisma.rosterEntry.findFirst({
    where: { id: entryId, batchId: id },
    include: { batch: { include: { exam: { include: { program: true } } } }, student: true },
  });
  if (!entry) notFound();
  const { batch } = entry;
  const programCode = batch.exam.program.code;
  const catalog = awardCatalog(programCode, batch.exam.round);

  const [pages, pending, otherCertificates] = await Promise.all([
    prisma.stagingPage.findMany({
      // หน้าที่ติดตั้งแต่ตอนตัด (สัญชาติ/รอบปี) ยังไม่ผูกกับใคร แต่เลขบนหน้าบอกได้ว่าเป็นของคนนี้
      where: { batchId: id, OR: [{ rosterEntryId: entry.id }, { rosterEntryId: null, certNo: entry.candidateNo }] },
      include: { certificate: { select: { id: true } }, sourceJob: { select: { payload: true } } },
      orderBy: { pageNumber: "asc" },
    }),
    prisma.job.count({ where: { batchId: id, type: { in: INTAKE_JOBS }, status: { in: ["QUEUED", "RUNNING"] } } }),
    entry.studentId
      ? prisma.certificate.count({ where: { studentId: entry.studentId, batchId: { not: id } } })
      : Promise.resolve(0),
  ]);

  const audit = await prisma.auditEvent.findMany({
    where: { entityId: { in: [entry.id, ...pages.map((p) => p.id)] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const locked = !batch.profileKey
    ? "รอบนี้มาจากระบบเดิม แก้ไขไม่ได้"
    : batch.status === "PUBLISHED"
      ? "เผยแพร่อยู่ — ยกเลิกการเผยแพร่ก่อน"
      : pending > 0
        ? "รอให้ระบบประมวลผลเสร็จก่อน"
        : null;

  const candidates = entry.student ? [] : await studentCandidates(pages.map((p) => p.review));
  const roundLabel = batch.exam.round === "HEAT" ? "รอบคัดเลือก" : "รอบชิงชนะเลิศ";

  return (
    <AdminShell
      title={entry.nameEn ?? entry.nameTh ?? entry.candidateNo}
      description={`${programCode} ${roundLabel} ${batch.exam.year} · เลข ${entry.candidateNo}`}
      back={{ href: `/admin/batches/${id}/participants`, label: "กลับรายชื่อผู้เข้าสอบ" }}
    >
      <p className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <ModeBadge mode={entry.examMode} />
        <span>{entry.source === "MANUAL" ? "เพิ่มเอง" : `จาก Excel${entry.sourceRow ? ` แถว ${entry.sourceRow}` : ""}`}</span>
        {entry.rawAward && <span>· รางวัลตาม Excel: {entry.rawAward}</span>}
      </p>

      <div className="space-y-6">
        <ParticipantEditor
          entry={{
            id: entry.id,
            batchId: id,
            version: entry.version,
            source: entry.source,
            candidateNo: entry.candidateNo,
            nameEn: entry.nameEn,
            nameTh: entry.nameTh,
            examMode: entry.examMode,
            school: entry.school,
            level: entry.level,
          }}
          locked={locked}
        />

        <IdentityPanel
          entryId={entry.id}
          version={entry.version}
          linked={
            entry.student
              ? {
                  id: entry.student.id,
                  name: entry.student.nameEn ?? entry.student.nameTh ?? "ไม่ระบุชื่อ",
                  school: entry.student.school,
                }
              : null
          }
          otherCertificates={otherCertificates}
          candidates={candidates}
          locked={locked}
        />

        <CertificateManager
          batchId={id}
          entryId={entry.id}
          catalog={catalog}
          locked={locked}
          pages={pages.map(
            (p): ParticipantPage => {
              const award = p.awardOverride ?? p.award ?? "";
              const upload = String(((p.sourceJob?.payload ?? {}) as { fileName?: unknown }).fileName ?? "");
              return {
                id: p.id,
                version: p.version,
                pageNumber: p.pageNumber,
                status: p.matchStatus,
                award,
                awardLabel: awardDisplay(programCode, award).label,
                folderAward: p.award,
                overridden: Boolean(p.awardOverride),
                zipMode: p.examMode,
                previewUrl: p.previewKey ? publicUrl(p.previewKey) : null,
                source: [upload, p.sourceFile].filter(Boolean).join(" › ") || "—",
                note: p.matchNote,
                hasCertificate: Boolean(p.certificate),
              };
            },
          )}
        />

        <section>
          <h2 className="mb-2 font-semibold">ประวัติการแก้ไขของคนนี้</h2>
          <AuditTrail
            events={audit.map((e) => ({
              id: e.id,
              action: e.action,
              entityType: e.entityType,
              entityId: e.entityId,
              sessionId: e.sessionId,
              createdAt: e.createdAt.toISOString(),
              before: e.before,
              after: e.after,
            }))}
          />
        </section>
      </div>
    </AdminShell>
  );
}

/** ตัวคนที่เป็นไปได้ของผู้เข้าสอบที่ระบบระบุตัวไม่ได้ — มาจากที่ตัวจับคู่บันทึกไว้บนหน้า */
async function studentCandidates(reviews: unknown[]): Promise<StudentCandidate[]> {
  const ids = new Set<string>();
  for (const review of reviews) {
    const list = (review as { studentCandidateIds?: unknown } | null)?.studentCandidateIds;
    if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
  }
  if (ids.size === 0) return [];
  const students = await prisma.student.findMany({
    where: { id: { in: [...ids] } },
    include: { certificates: { include: { exam: { include: { program: true } } }, take: 10 } },
  });
  return students.map((s) => ({
    id: s.id,
    name: s.nameEn ?? s.nameTh ?? "ไม่ระบุชื่อ",
    school: s.school,
    certificates: s.certificates.map(
      (c) => `${c.exam.program.code} ${c.exam.round} ${c.exam.year} ${awardDisplay(c.exam.program.code, c.award).label}`,
    ),
  }));
}
