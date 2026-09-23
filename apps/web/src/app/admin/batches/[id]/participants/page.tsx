import type { MatchStatus, Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddParticipantForm, type ParticipantDraft } from "@/components/admin/AddParticipantForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { ModeBadge, PageStatusBadge, pageStatusLabel } from "@/components/admin/StatusBadge";
import { isAuthenticated } from "@/lib/auth";
import { awardCatalog, awardDisplay } from "@/lib/certificate-catalog";
import { prisma } from "@/lib/db";
import { ISSUE_STATUSES } from "@/lib/batch-view";
import { normalizeName } from "@/lib/normalize";

export const dynamic = "force-dynamic";

const LIMIT = 200;

type Search = {
  q?: string;
  mode?: string;
  award?: string;
  issue?: string;
  source?: string;
  cert?: string;
  add?: string;
  fromPage?: string;
};

/**
 * ค้นหาและแก้ไขผู้เข้าสอบของรอบนำเข้านี้ — ค้นด้วยชื่อหรือเลข กรองตามรูปแบบการสอบ รางวัล
 * ปัญหาที่ค้าง ที่มาของรายชื่อ และการมีเกียรติบัตร
 */
export default async function ParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  if (!(await isAuthenticated())) redirect("/admin/login");
  const { id } = await params;
  const search = await searchParams;

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { exam: { include: { program: true } } },
  });
  if (!batch) notFound();
  const programCode = batch.exam.program.code;
  const catalog = awardCatalog(programCode, batch.exam.round);

  const pending = await prisma.job.count({
    where: { batchId: id, type: { in: ["SPLIT", "MATCH", "ROSTER_VALIDATE", "ROSTER_ACTIVATE"] }, status: { in: ["QUEUED", "RUNNING"] } },
  });
  const locked = !batch.profileKey
    ? "รอบนี้มาจากระบบเดิม แก้ไขไม่ได้"
    : batch.status === "PUBLISHED"
      ? "เผยแพร่อยู่ — ยกเลิกการเผยแพร่ก่อน"
      : pending > 0
        ? "รอให้ระบบประมวลผลเสร็จก่อน"
        : !batch.activeRosterImportId
          ? "ต้องใช้รายชื่อผู้เข้าสอบก่อน"
          : null;

  const where = buildWhere(id, search);
  const [entries, total] = await Promise.all([
    prisma.rosterEntry.findMany({
      where,
      include: {
        certificates: { select: { award: true, awardLabel: true } },
        stagingPages: { where: { matchStatus: { in: ISSUE_STATUSES } }, select: { matchStatus: true } },
      },
      orderBy: [{ examMode: "asc" }, { candidateNo: "asc" }],
      take: LIMIT,
    }),
    prisma.rosterEntry.count({ where }),
  ]);

  const draft = search.add ? await draftFromPage(id, search.fromPage) : undefined;
  const roundLabel = batch.exam.round === "HEAT" ? "รอบคัดเลือก" : "รอบชิงชนะเลิศ";

  return (
    <AdminShell
      title={`ผู้เข้าสอบ ${programCode} ${roundLabel} ${batch.exam.year}`}
      back={{ href: `/admin/batches/${id}`, label: "กลับหน้ารอบนำเข้า" }}
    >
      <form className="mb-4 grid gap-2 rounded-xl border border-hairline bg-card p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <input
          name="q"
          defaultValue={search.q ?? ""}
          placeholder="ชื่อหรือเลขผู้เข้าสอบ"
          className="rounded-lg border border-hairline px-3 py-2 sm:col-span-3 lg:col-span-2"
        />
        <Select name="mode" value={search.mode} options={[["", "ทุกรูปแบบ"], ["ONLINE", "Online"], ["ONSITE", "Onsite"]]} />
        <Select
          name="award"
          value={search.award}
          options={[["", "ทุกรางวัล"], ...catalog.map((a) => [a.code, a.label] as [string, string])]}
        />
        <Select
          name="issue"
          value={search.issue}
          options={[
            ["", "ทุกสถานะ"],
            ["ANY", "มีหน้าที่รอตัดสิน"],
            ...ISSUE_STATUSES.filter((s) => s !== "UNMATCHED").map((s) => [s, pageStatusLabel(s)] as [string, string]),
          ]}
        />
        <Select name="source" value={search.source} options={[["", "ทุกที่มา"], ["EXCEL", "จาก Excel"], ["MANUAL", "เพิ่มเอง"]]} />
        <Select name="cert" value={search.cert} options={[["", "มี/ไม่มีใบ"], ["HAS", "มีเกียรติบัตร"], ["NONE", "ยังไม่มีใบ"]]} />
        <button
          type="submit"
          className="min-h-10 cursor-pointer rounded-xl bg-brand px-4 font-semibold text-white transition duration-200 hover:bg-brand-dark"
        >
          ค้นหา
        </button>
      </form>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-ink-soft">
          พบ {total} คน{total > LIMIT && ` (แสดง ${LIMIT} คนแรก — ค้นให้แคบลงเพื่อดูที่เหลือ)`}
        </p>
        {!search.add && (
          <Link
            href={`/admin/batches/${id}/participants?add=1`}
            className="min-h-10 cursor-pointer rounded-xl border border-hairline bg-card px-3 py-2 transition duration-200 hover:bg-paper"
          >
            + เพิ่มผู้เข้าสอบที่ตกหล่น
          </Link>
        )}
      </div>

      {search.add && (
        <div className="mb-6">
          <AddParticipantForm batchId={id} initial={draft} locked={locked} />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-hairline bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline bg-paper text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">เลข</th>
              <th className="px-3 py-2 font-medium">ชื่อ</th>
              <th className="px-3 py-2 font-medium">รูปแบบ</th>
              <th className="px-3 py-2 font-medium">ระดับชั้น / โรงเรียน</th>
              <th className="px-3 py-2 font-medium">เกียรติบัตร</th>
              <th className="px-3 py-2 font-medium">ที่ต้องตัดสิน</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-hairline last:border-0 hover:bg-paper">
                <td className="px-3 py-2 tabular-nums">
                  <Link href={`/admin/batches/${id}/participants/${e.id}`} className="text-brand underline-offset-2 hover:underline">
                    {e.candidateNo}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/admin/batches/${id}/participants/${e.id}`} className="hover:underline">
                    {e.nameEn ?? e.nameTh}
                  </Link>
                  {e.nameEn && e.nameTh && <span className="block text-ink-soft">{e.nameTh}</span>}
                  {e.source === "MANUAL" && <span className="block text-xs text-brand">เพิ่มเอง</span>}
                </td>
                <td className="px-3 py-2">
                  <ModeBadge mode={e.examMode} />
                </td>
                <td className="px-3 py-2 text-ink-soft">
                  {[e.level, e.school].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2">
                  {e.certificates.length === 0 ? (
                    <span className="text-warn-ink">ยังไม่มี</span>
                  ) : (
                    e.certificates.map((c) => awardDisplay(programCode, c.award, { label: c.awardLabel }).label).join(", ")
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(e.stagingPages.map((p) => p.matchStatus))].map((s) => (
                      <PageStatusBadge key={s} status={s} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                  ไม่พบผู้เข้าสอบที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function buildWhere(batchId: string, search: Search): Prisma.RosterEntryWhereInput {
  const and: Prisma.RosterEntryWhereInput[] = [{ batchId }];
  const q = (search.q ?? "").trim();
  if (q) {
    const name = normalizeName(q);
    and.push({
      OR: [
        { candidateNo: { contains: q } },
        ...(name ? [{ nameEnNormalized: { contains: name } }, { nameThNormalized: { contains: name } }] : []),
      ],
    });
  }
  if (search.mode === "ONLINE" || search.mode === "ONSITE") and.push({ examMode: search.mode });
  if (search.source === "EXCEL" || search.source === "MANUAL") and.push({ source: search.source });
  if (search.award) and.push({ certificates: { some: { award: search.award } } });
  if (search.cert === "HAS") and.push({ certificates: { some: {} } });
  if (search.cert === "NONE") and.push({ certificates: { none: {} } });
  if (search.issue === "ANY") and.push({ stagingPages: { some: { matchStatus: { in: ISSUE_STATUSES } } } });
  else if (search.issue && ISSUE_STATUSES.includes(search.issue as MatchStatus)) {
    and.push({ stagingPages: { some: { matchStatus: search.issue as MatchStatus } } });
  }
  return { AND: and };
}

/** เติมฟอร์มเพิ่มผู้เข้าสอบจากหน้าที่จับคู่ไม่ได้ — แอดมินแค่ตรวจแล้วกดบันทึก */
async function draftFromPage(batchId: string, pageId?: string): Promise<ParticipantDraft | undefined> {
  if (!pageId) return undefined;
  const page = await prisma.stagingPage.findFirst({ where: { id: pageId, batchId } });
  if (!page) return undefined;
  return {
    candidateNo: page.certNo,
    nameEn: page.extractedName,
    examMode: page.examMode,
    school: page.schoolOnPage,
    level: page.level,
  };
}

function Select({ name, value, options }: { name: string; value?: string; options: [string, string][] }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="rounded-lg border border-hairline bg-card px-2 py-2">
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
