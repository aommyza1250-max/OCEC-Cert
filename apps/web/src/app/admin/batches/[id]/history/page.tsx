import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AuditTrail, type AuditRow } from "@/components/admin/AuditTrail";
import { auditCandidateNo } from "@/lib/audit-display";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** ประวัติของรอบนำเข้านี้เท่านั้น ไม่ใช่ log รวมทุกโครงการ */
export default async function BatchHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/admin/login");
  const { id } = await params;
  const { page: rawPage } = await searchParams;
  const parsedPage = Number(rawPage);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 1000) : 1;

  const batch = await prisma.batch.findUnique({
    where: { id },
    select: { exam: { select: { round: true, year: true, program: { select: { code: true } } } } },
  });
  if (!batch) notFound();

  const events = await prisma.auditEvent.findMany({
    where: { batchId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, before: true, after: true },
  });
  const hasNext = events.length > PAGE_SIZE;
  const shown = events.slice(0, PAGE_SIZE);
  const entryIds = shown.filter((e) => e.entityType === "ROSTER_ENTRY" && e.entityId).map((e) => e.entityId!);
  const pageIds = shown.filter((e) => e.entityType === "STAGING_PAGE" && e.entityId).map((e) => e.entityId!);
  const [entries, pages] = await Promise.all([
    prisma.rosterEntry.findMany({ where: { batchId: id, id: { in: entryIds } }, select: { id: true, candidateNo: true, nameEn: true, nameTh: true } }),
    prisma.stagingPage.findMany({ where: { batchId: id, id: { in: pageIds } }, select: { id: true, certNo: true, extractedName: true, pageNumber: true } }),
  ]);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const rows: AuditRow[] = shown.map((event) => {
    const entry = event.entityType === "ROSTER_ENTRY" ? entryById.get(event.entityId ?? "") : undefined;
    const certificatePage = event.entityType === "STAGING_PAGE" ? pageById.get(event.entityId ?? "") : undefined;
    const candidateNo = entry?.candidateNo ?? certificatePage?.certNo ?? auditCandidateNo(event.before, event.after);
    const name = entry?.nameEn ?? entry?.nameTh ?? certificatePage?.extractedName;
    return {
      id: event.id,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
      before: event.before,
      after: event.after,
      subject: [candidateNo && `เลข ${candidateNo}`, name, certificatePage && `หน้า ${certificatePage.pageNumber}`].filter(Boolean).join(" · ") || null,
    };
  });

  const { code } = batch.exam.program;
  const round = batch.exam.round === "HEAT" ? "รอบคัดเลือก" : "รอบชิงชนะเลิศ";
  const base = `/admin/batches/${id}/history`;

  return (
    <AdminShell
      title="ประวัติการแก้ไข"
      description={`${code} ${round} ${batch.exam.year} · เฉพาะรอบนำเข้านี้`}
      back={{ href: `/admin/batches/${id}`, label: "กลับหน้ารอบนำเข้า" }}
    >
      <p className="mb-5 text-sm text-ink-soft">
        แสดงการเปลี่ยนแปลงที่ใช้ตรวจย้อนหลังได้ บัญชีแอดมินใช้ร่วมกัน จึงไม่สามารถระบุได้ว่าเป็นผู้แก้ไขคนใด
      </p>
      <AuditTrail events={rows} programCode={code} empty="รอบนี้ยังไม่มีประวัติการแก้ไข" />
      {(page > 1 || hasNext) && (
        <nav className="mt-6 flex items-center justify-between gap-3 text-sm" aria-label="หน้าประวัติการแก้ไข">
          {page > 1 ? <Link href={`${base}?page=${page - 1}`} className="text-brand underline underline-offset-2">← ใหม่กว่า</Link> : <span />}
          <span className="text-ink-soft">หน้า {page}</span>
          {hasNext ? <Link href={`${base}?page=${page + 1}`} className="text-brand underline underline-offset-2">เก่ากว่า →</Link> : <span />}
        </nav>
      )}
    </AdminShell>
  );
}
