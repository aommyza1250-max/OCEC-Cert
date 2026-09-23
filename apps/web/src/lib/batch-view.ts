/**
 * ข้อมูลของหน้ารอบนำเข้า — อ่านทีเดียวที่ฝั่งเซิร์ฟเวอร์ แล้วส่งให้แต่ละส่วนของหน้าจอ
 *
 * ตัวเลขทุกตัวนับสดจากตาราง ไม่อ่านจากสถิติที่เก็บไว้ในรอบนำเข้า
 * เพราะอัปหลายครั้ง แก้ไข และจับคู่ใหม่ได้ สถิติของงานครั้งเดียวจึงไม่ใช่ภาพรวมของรอบ
 */
import type { MatchStatus } from "@prisma/client";
import { awardCatalog, awardDisplay } from "./certificate-catalog";
import { prisma } from "./db";
import { INTAKE_JOBS } from "./batch-guard";
import {
  decidePublish,
  loadParticipants,
  needsPolicyDecision,
  summarize,
  type HoldReason,
  type Mode,
  type PublishSummary,
} from "./publish";
import { publicUrl } from "./r2";

/** หน้าที่ต้องให้แอดมินตัดสิน — เรียงตามลำดับที่ควรแก้ */
export const ISSUE_STATUSES: MatchStatus[] = [
  "NAME_MISMATCH",
  "MODE_MISMATCH",
  "AMBIGUOUS",
  "DUPLICATE_NAME",
  "NATIONALITY_UNVERIFIED",
  "PARSE_REVIEW",
  "UNMATCHED",
];

export type EntryRef = {
  id: string;
  candidateNo: string;
  name: string;
  examMode: Mode;
  school: string | null;
  level: string | null;
};

export type IssuePage = {
  id: string;
  version: number;
  pageNumber: number;
  status: MatchStatus;
  note: string | null;
  extractedName: string | null;
  certNo: string | null;
  level: string | null;
  zipMode: Mode | null;
  award: string;
  awardLabel: string;
  folderAward: string | null;
  schoolOnPage: string | null;
  countryOnPage: string | null;
  sourceFile: string | null;
  uploadName: string | null;
  previewUrl: string | null;
  warnings: string[];
  parseErrors: string[];
  entry: EntryRef | null;
  candidates: EntryRef[];
  acceptedPage: { id: string; pageNumber: number; previewUrl: string | null } | null;
  identityPending: boolean;
};

export type MissingItem = EntryRef & {
  version: number;
  reason: HoldReason;
  rawAward: string | null;
  awards: string[];
  lastError: string | null;
};

export type UploadRecord = {
  jobId: string;
  kind: "zip" | "single";
  fileName: string | null;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  userError: boolean;
  progress: Record<string, unknown>;
  pages: Record<string, number>;
};

export type RosterDraft = {
  id: string;
  status: string;
  fileName: string | null;
  uploadedAt: string;
  totalCount: number;
  onlineCount: number;
  onsiteCount: number;
  errors: { row: number | null; column: string | null; message: string }[];
  conflicts: RosterConflict[];
};

export type RosterConflict = {
  id: string;
  reason: "SAME_NUMBER" | "SAME_NAME";
  manualEntryId: string;
  incomingCandidateNo: string;
  manual: Record<string, string | null>;
  incoming: Record<string, string | number | null>;
};

export type BatchView = Awaited<ReturnType<typeof loadBatchView>>;

export async function loadBatchView(batchId: string) {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { exam: { include: { program: true } }, activeRosterImport: true },
  });
  if (!batch) return null;

  const programCode = batch.exam.program.code;
  const round = batch.exam.round;
  const catalog = awardCatalog(programCode, round);
  const guarded = { id: batch.id, programCode, round };

  const [entryCounts, drafts, uploads, pendingJobs, runningJob, latestFailure, certificateCount, publishedCount, audit] =
    await Promise.all([
      prisma.rosterEntry.groupBy({ by: ["examMode", "source"], where: { batchId }, _count: true }),
      prisma.rosterImport.findMany({
        where: { batchId, status: { in: ["PENDING", "READY", "INVALID", "ACTIVATING"] } },
        orderBy: { uploadedAt: "desc" },
        take: 1,
      }),
      loadUploads(batchId),
      prisma.job.count({ where: { batchId, type: { in: INTAKE_JOBS }, status: { in: ["QUEUED", "RUNNING"] } } }),
      prisma.job.findFirst({
        where: { batchId, status: { in: ["RUNNING", "QUEUED"] } },
        orderBy: [{ status: "desc" }, { createdAt: "asc" }],
      }),
      prisma.job.findFirst({
        where: { batchId, status: "FAILED", userError: false, type: { in: INTAKE_JOBS } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.certificate.count({ where: { batchId } }),
      prisma.certificate.count({ where: { batchId, published: { not: null } } }),
      prisma.auditEvent.findMany({ where: { batchId }, orderBy: { createdAt: "desc" }, take: 15 }),
    ]);

  const count = (mode?: Mode, source?: "EXCEL" | "MANUAL") =>
    entryCounts
      .filter((c) => (!mode || c.examMode === mode) && (!source || c.source === source))
      .reduce((n, c) => n + c._count, 0);

  const participants = batch.profileKey ? await loadParticipants(prisma, guarded) : [];
  const decision = decidePublish(participants, batch.multiAwardPolicy);
  const summary: PublishSummary = summarize(decision);

  const draft = drafts[0];
  const processing = pendingJobs > 0;

  return {
    batch: {
      id: batch.id,
      status: batch.status,
      programCode,
      programName: batch.exam.program.name,
      round,
      year: batch.exam.year,
      profileKey: batch.profileKey,
      legacy: !batch.profileKey,
      createdAt: batch.createdAt.toISOString(),
      multiAwardPolicy: batch.multiAwardPolicy,
      sourcesClearedAt: batch.sourcesClearedAt?.toISOString() ?? null,
    },
    catalog,
    roster: {
      active: batch.activeRosterImport
        ? {
            id: batch.activeRosterImport.id,
            fileName: batch.activeRosterImport.fileName,
            activatedAt: batch.activeRosterImport.activatedAt?.toISOString() ?? null,
          }
        : null,
      totals: {
        total: count(),
        online: count("ONLINE"),
        onsite: count("ONSITE"),
        excel: count(undefined, "EXCEL"),
        manual: count(undefined, "MANUAL"),
      },
      draft: draft ? serializeDraft(draft) : null,
    },
    uploads,
    processing,
    activeJob: runningJob
      ? { type: runningJob.type, status: runningJob.status, progress: runningJob.progress as Record<string, unknown> }
      : null,
    systemFailure: latestFailure ? (latestFailure.error ?? "").split("\n")[0] : null,
    issues: processing ? [] : await loadIssues(batchId, programCode),
    missing: processing ? [] : await loadMissing(batchId, decision.heldParticipants),
    publish: {
      summary,
      needsDecision: needsPolicyDecision(participants),
      certificateCount,
      publishedCount,
    },
    audit: audit.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      sessionId: e.sessionId,
      createdAt: e.createdAt.toISOString(),
      before: e.before,
      after: e.after,
    })),
  };
}

function serializeDraft(draft: {
  id: string;
  status: string;
  fileName: string | null;
  uploadedAt: Date;
  totalCount: number;
  onlineCount: number;
  onsiteCount: number;
  errors: unknown;
  conflicts: unknown;
}): RosterDraft {
  return {
    id: draft.id,
    status: draft.status,
    fileName: draft.fileName,
    uploadedAt: draft.uploadedAt.toISOString(),
    totalCount: draft.totalCount,
    onlineCount: draft.onlineCount,
    onsiteCount: draft.onsiteCount,
    errors: Array.isArray(draft.errors) ? (draft.errors as RosterDraft["errors"]) : [],
    conflicts: Array.isArray(draft.conflicts) ? (draft.conflicts as RosterConflict[]) : [],
  };
}

async function loadUploads(batchId: string): Promise<UploadRecord[]> {
  const jobs = await prisma.job.findMany({
    where: { batchId, type: "SPLIT" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const counts = await prisma.stagingPage.groupBy({
    by: ["sourceJobId", "matchStatus"],
    where: { batchId, sourceJobId: { in: jobs.map((j) => j.id) } },
    _count: true,
  });
  return jobs.map((job) => {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const pages: Record<string, number> = {};
    for (const c of counts.filter((c) => c.sourceJobId === job.id)) pages[c.matchStatus] = c._count;
    return {
      jobId: job.id,
      kind: payload.kind === "single" ? "single" : "zip",
      fileName: typeof payload.fileName === "string" ? payload.fileName : null,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      // บรรทัดแรกคือคำอธิบายสำหรับคน ที่เหลือเป็น traceback สำหรับคนแก้โค้ด
      error: job.error ? job.error.split("\n")[0] : null,
      userError: job.userError,
      progress: (job.progress ?? {}) as Record<string, unknown>,
      pages,
    };
  });
}

const entrySelect = {
  id: true,
  candidateNo: true,
  nameEn: true,
  nameTh: true,
  examMode: true,
  school: true,
  level: true,
} as const;

function entryRef(e: {
  id: string;
  candidateNo: string;
  nameEn: string | null;
  nameTh: string | null;
  examMode: Mode;
  school: string | null;
  level: string | null;
}): EntryRef {
  return {
    id: e.id,
    candidateNo: e.candidateNo,
    name: e.nameEn ?? e.nameTh ?? "ไม่ระบุชื่อ",
    examMode: e.examMode,
    school: e.school,
    level: e.level,
  };
}

/** หน้าที่ต้องตัดสิน สูงสุด 200 หน้า — มากกว่านั้นแปลว่ามีปัญหาทั้งไฟล์ ต้องแก้ที่ต้นทางมากกว่าไล่ทีละหน้า */
export async function loadIssues(batchId: string, programCode: string): Promise<IssuePage[]> {
  const pages = await prisma.stagingPage.findMany({
    where: { batchId, matchStatus: { in: ISSUE_STATUSES } },
    include: { rosterEntry: { select: entrySelect }, sourceJob: { select: { payload: true } } },
    orderBy: { pageNumber: "asc" },
    take: 200,
  });

  const candidateIds = new Set<string>();
  const acceptedIds = new Set<string>();
  for (const p of pages) {
    const review = (p.review ?? {}) as Record<string, unknown>;
    if (Array.isArray(review.candidateEntryIds)) review.candidateEntryIds.forEach((id) => candidateIds.add(String(id)));
    if (typeof review.acceptedPageId === "string") acceptedIds.add(review.acceptedPageId);
  }
  const [candidates, accepted] = await Promise.all([
    prisma.rosterEntry.findMany({ where: { id: { in: [...candidateIds] } }, select: entrySelect }),
    prisma.stagingPage.findMany({
      where: { id: { in: [...acceptedIds] } },
      select: { id: true, pageNumber: true, previewKey: true },
    }),
  ]);
  const candidateById = new Map(candidates.map((c) => [c.id, entryRef(c)]));
  const acceptedById = new Map(accepted.map((a) => [a.id, a]));
  const order = new Map(ISSUE_STATUSES.map((s, i) => [s, i]));

  return pages
    .map((p) => {
      const review = (p.review ?? {}) as Record<string, unknown>;
      const effective = p.awardOverride ?? p.award ?? "";
      const acceptedPage =
        typeof review.acceptedPageId === "string" ? acceptedById.get(review.acceptedPageId) : undefined;
      return {
        id: p.id,
        version: p.version,
        pageNumber: p.pageNumber,
        status: p.matchStatus,
        note: p.matchNote,
        extractedName: p.extractedName,
        certNo: p.certNo,
        level: p.level,
        zipMode: p.examMode,
        award: effective,
        awardLabel: awardDisplay(programCode, effective).label,
        folderAward: p.award,
        schoolOnPage: p.schoolOnPage,
        countryOnPage: p.countryOnPage,
        sourceFile: p.sourceFile,
        uploadName: String(((p.sourceJob?.payload ?? {}) as { fileName?: unknown }).fileName ?? "") || null,
        previewUrl: p.previewKey ? publicUrl(p.previewKey) : null,
        warnings: [
          ...(Array.isArray(p.warnings) ? (p.warnings as string[]) : []),
          ...(Array.isArray(review.warnings) ? (review.warnings as string[]) : []),
        ],
        parseErrors: Array.isArray(p.parseErrors) ? (p.parseErrors as string[]) : [],
        entry: p.rosterEntry ? entryRef(p.rosterEntry) : null,
        candidates: Array.isArray(review.candidateEntryIds)
          ? review.candidateEntryIds.map((id) => candidateById.get(String(id))).filter((c): c is EntryRef => !!c)
          : [],
        acceptedPage: acceptedPage
          ? {
              id: acceptedPage.id,
              pageNumber: acceptedPage.pageNumber,
              previewUrl: acceptedPage.previewKey ? publicUrl(acceptedPage.previewKey) : null,
            }
          : null,
        identityPending: review.identity === true,
      };
    })
    .sort((a, b) => (order.get(a.status) ?? 99) - (order.get(b.status) ?? 99) || a.pageNumber - b.pageNumber);
}

/** ผู้เข้าสอบที่ยังขาดไฟล์ — ไม่มีใบเลย หรือมีแต่ใบรางวัลเสริม */
async function loadMissing(
  batchId: string,
  held: { entryId: string; reason: HoldReason }[],
): Promise<MissingItem[]> {
  const missing = held.filter((h) => h.reason === "MISSING_FILE" || h.reason === "MISSING_PRIMARY");
  if (missing.length === 0) return [];
  const reason = new Map(missing.map((m) => [m.entryId, m.reason]));

  const [entries, certificates, jobs] = await Promise.all([
    prisma.rosterEntry.findMany({
      where: { id: { in: [...reason.keys()] } },
      select: { ...entrySelect, version: true, rawAward: true },
      orderBy: [{ examMode: "asc" }, { candidateNo: "asc" }],
    }),
    prisma.certificate.findMany({
      where: { rosterEntryId: { in: [...reason.keys()] } },
      select: { rosterEntryId: true, award: true },
    }),
    prisma.job.findMany({
      where: { batchId, type: "SPLIT", status: { in: ["FAILED", "DONE"] } },
      select: { status: true, error: true, userError: true, payload: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // ผลของไฟล์ที่อัปให้แต่ละคนครั้งล่าสุด ถ้าไม่ถูกรับ — อยู่ติดกับช่องอัปโหลดของคนนั้น
  // เก็บไว้ที่นี่เพื่อให้ยังเห็นอยู่หลังรีเฟรชหน้า
  const lastError = new Map<string, string | null>();
  for (const job of jobs) {
    const entryId = (job.payload as { rosterEntryId?: unknown })?.rosterEntryId;
    if (typeof entryId !== "string" || lastError.has(entryId)) continue;
    lastError.set(entryId, job.status === "FAILED" && job.userError && job.error ? job.error.split("\n")[0] : null);
  }

  return entries.map((e) => ({
    ...entryRef(e),
    version: e.version,
    reason: reason.get(e.id)!,
    rawAward: e.rawAward,
    awards: certificates.filter((c) => c.rosterEntryId === e.id).map((c) => c.award),
    lastError: lastError.get(e.id) ?? null,
  }));
}
