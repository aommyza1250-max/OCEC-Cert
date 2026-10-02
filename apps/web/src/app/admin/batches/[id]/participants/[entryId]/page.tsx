import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { AuditTrail } from "@/components/admin/AuditTrail";
import { CertificateManager, type ParticipantPage } from "@/components/admin/CertificateManager";
import { IdentityPanel, type StudentCandidate } from "@/components/admin/IdentityPanel";
import { ParticipantEditor } from "@/components/admin/ParticipantEditor";
import { ModeBadge } from "@/components/admin/StatusBadge";
import { SupplementalApprovalPanel } from "@/components/admin/SupplementalApprovalPanel";
import { isAuthenticated } from "@/lib/auth";
import { INTAKE_JOBS } from "@/lib/batch-guard";
import { awardCatalog, awardDisplay } from "@/lib/certificate-catalog";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/r2";
import { supplementalOnlySnapshot } from "@/lib/publish-rules";

export const dynamic = "force-dynamic";

/**
 * รายละเอียดผู้เข้าสอบ 1 คน — ข้อมูลการสอบแยกจากเกียรติบัตรชัดเจน
 * พร้อมประวัติการแก้ไขทั้งหมดของคนนี้ (อะไรเปลี่ยนจากอะไรเป็นอะไร เมื่อไหร่ จาก session ไหน)
 */
export default async function ParticipantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; entryId: string }>;
  searchParams: Promise<{ returnPanel?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/admin/login");
  const { id, entryId } = await params;
  const { returnPanel } = await searchParams;
  const overviewHref = `/admin/batches/${id}?step=3${returnPanel === "issues" || returnPanel === "missing" ? `&panel=${returnPanel}` : ""}`;

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
      include: { certificate: { select: { id: true, award: true, pdfKey: true, previewKey: true } }, sourceJob: { select: { payload: true } } },
      orderBy: { pageNumber: "asc" },
    }),
    prisma.job.count({ where: { batchId: id, type: { in: INTAKE_JOBS }, status: { in: ["QUEUED", "RUNNING"] } } }),
    entry.studentId
      ? prisma.certificate.count({ where: { studentId: entry.studentId, batchId: { not: id } } })
      : Promise.resolve(0),
  ]);

  const audit = await prisma.auditEvent.findMany({
    where: { batchId: id, entityId: { in: [entry.id, ...pages.map((p) => p.id)] } },
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

  const candidates = await studentCandidates(pages.map((p) => p.review), entry);
  const kinds = new Map(catalog.map((award) => [award.code, award.kind]));
  const certificateRefs = pages.flatMap((page) => page.certificate ? [{
    ...page.certificate,
    kind: kinds.get(page.certificate.award) ?? "PRIMARY" as const,
  }] : []);
  const currentSnapshot = supplementalOnlySnapshot(certificateRefs);
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
          overviewHref={overviewHref}
          candidateNo={entry.candidateNo}
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

        {entry.supplementalOnlySnapshot && (
          <SupplementalApprovalPanel
            entryId={entry.id}
            version={entry.version}
            current={currentSnapshot !== null && currentSnapshot === entry.supplementalOnlySnapshot}
            locked={locked}
          />
        )}

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
            programCode={programCode}
            events={audit.map((e) => ({
              id: e.id,
              action: e.action,
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

/** ตัวคนที่เป็นไปได้: ก่อนตัดสินใช้ผลของ worker; หลังตัดสินค้นชื่อเดิมอีกครั้งเพื่อให้แก้การกดผิดได้ */
async function studentCandidates(
  reviews: unknown[],
  entry: {
    id: string;
    batchId: string;
    studentId: string | null;
    nameEnNormalized: string | null;
    nameThNormalized: string | null;
  },
): Promise<StudentCandidate[]> {
  const ids = new Set<string>();
  for (const review of reviews) {
    const list = (review as { studentCandidateIds?: unknown } | null)?.studentCandidateIds;
    if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
  }
  const names = [...new Set([entry.nameEnNormalized, entry.nameThNormalized].filter((n): n is string => !!n))];
  if (!entry.studentId && ids.size === 0) return [];
  if (entry.studentId && names.length === 0) return [];
  const where: Prisma.StudentWhereInput = entry.studentId
    ? {
        id: { not: entry.studentId },
        AND: [
          { OR: [{ nameEnNormalized: { in: names } }, { nameThNormalized: { in: names } }] },
          // ระเบียนที่ไม่มีทั้งรายชื่อและใบเป็นซากจากการตัดสินก่อนหน้า ไม่เสนอให้ผูกซ้ำ
          { OR: [{ rosterEntries: { some: {} } }, { certificates: { some: {} } }] },
          // ผู้เข้าสอบสองคนในรอบเดียวกันห้ามใช้ตัวคนร่วมกัน
          { rosterEntries: { none: { batchId: entry.batchId, id: { not: entry.id } } } },
        ],
      }
    : { id: { in: [...ids] } };
  const students = await prisma.student.findMany({
    where,
    include: {
      certificates: {
        include: { exam: { include: { program: true } } },
        orderBy: { exam: { year: "desc" } },
        take: 10,
      },
    },
    orderBy: { createdAt: "asc" },
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
