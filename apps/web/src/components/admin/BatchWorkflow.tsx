"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BatchView } from "@/lib/batch-view";
import { CertificatesPanel } from "./CertificatesPanel";
import { DangerZone } from "./DangerZone";
import { IssueList } from "./IssueList";
import { MissingList } from "./MissingList";
import { PublishPanel } from "./PublishPanel";
import { RosterPanel } from "./RosterPanel";
import { RetentionPanel } from "./RetentionPanel";
import { SourcesPanel } from "./SourcesPanel";
import { StatusBadge } from "./StatusBadge";

/** ชื่อขั้นตอนที่แอดมินเข้าใจ — แยกให้ชัดว่ากำลังทำอะไรอยู่ ไม่ใช่ "กำลังประมวลผล" ลอย ๆ */
const STAGE_LABEL: Record<string, string> = {
  SPLIT: "กำลังตรวจ ZIP ตัดแยกหน้า และจับคู่",
  MATCH: "กำลังจับคู่กับรายชื่อใหม่",
  ROSTER_VALIDATE: "กำลังตรวจไฟล์รายชื่อ",
  ROSTER_ACTIVATE: "กำลังเปลี่ยนรายชื่อและจับคู่ใหม่ทั้งรอบ",
  CLEANUP_SOURCES: "กำลังเคลียร์ไฟล์ต้นฉบับ",
  DELETE_BATCH: "กำลังลบรอบการนำเข้า",
};

type IntakeStep = 1 | 2 | 3;

type DeleteInfo = {
  confirmPhrase: string;
  counts: { certificates: number; pages: number; students: number };
  siblingBatches: number;
};

type RetentionInfo = { expiresAt: string | null; deletedFiles: number };

/**
 * หน้ารอบนำเข้าแบ่งเป็น 3 ขั้นเพื่อให้อ่านง่าย แต่คง component และ action เดิมไว้:
 *   1. รายชื่อ  2. ZIP / จับคู่ / ประวัติการอัป  3. ภาพรวมและจัดการรอบ
 */
export function BatchWorkflow({
  view,
  levelSubfolder,
  deleteInfo,
  retention,
  blockers,
}: {
  view: NonNullable<BatchView>;
  levelSubfolder: boolean;
  deleteInfo: DeleteInfo;
  retention: RetentionInfo;
  blockers: string[] | null;
}) {
  const router = useRouter();
  const { batch, roster } = view;
  const published = batch.status === "PUBLISHED";
  const draftBusy = roster.draft?.status === "PENDING" || roster.draft?.status === "ACTIVATING";
  const running = view.processing || draftBusy || batch.status === "DELETING";
  const hasRoster = Boolean(roster.active);
  const [activeStep, setActiveStep] = useState<IntakeStep>(() => (published ? 3 : hasRoster ? 2 : 1));
  const [reviewPanel, setReviewPanel] = useState<"issues" | "missing" | null>(null);

  // ระหว่าง worker ทำงานให้รีเฟรชหน้าเองทุก 3 วินาที แอดมินจะได้ไม่ต้องกด F5
  // รีเฟรชเฉพาะตอนที่แท็บเปิดอยู่จริง — ยิงรัวขณะสลับไปแอปอื่นบนเน็ตมือถือมีแต่จะล้มเป็นชุด
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  const locked = batch.legacy
    ? "รอบนี้มาจากระบบเดิม — ต้องลบแล้วนำเข้าใหม่"
    : published
      ? "เผยแพร่อยู่ — ยกเลิกการเผยแพร่ก่อนจึงจะแก้ไขได้"
      : null;
  const editLocked = locked ?? (view.processing ? "รอให้ระบบประมวลผลเสร็จก่อน" : null);
  const timelineShowsActiveJob = activeStep === 2 && (
    view.activeJob?.type === "MATCH" && view.uploads.some((upload) => upload.kind === "zip") ||
    view.activeJob?.type === "SPLIT" && view.uploads[0]?.kind === "zip"
  );
  const steps = [
    {
      id: 1 as const,
      title: "1 · รายชื่อ",
      detail: hasRoster ? `ตรวจแล้ว ${formatCount(roster.totals.total)} คน` : "อัปโหลดและตรวจรายชื่อ",
      done: hasRoster,
    },
    {
      id: 2 as const,
      title: "2 · เกียรติบัตร",
      detail: "อัป ZIP และจับคู่",
      done: view.uploads.some((upload) => upload.status === "DONE"),
    },
    {
      id: 3 as const,
      title: "3 · ภาพรวมรอบนี้",
      detail: "รายการค้างและเผยแพร่",
      done: published,
    },
  ];

  return (
    <div className="space-y-6">
      {batch.legacy && (
        <p className="rounded-xl border border-warn-line bg-warn-bg px-5 py-4 text-sm text-warn-ink">
          รอบนี้นำเข้าด้วยระบบเดิม (ก่อนมีรายชื่อ online/onsite) ข้อมูลยังเผยแพร่อยู่ตามเดิม
          แต่แก้ไขหรือเติมไฟล์ด้วยขั้นตอนใหม่ไม่ได้ — ถ้าต้องแก้ ให้สำรองข้อมูล ลบรอบนี้
          แล้วนำเข้าใหม่ตามขั้นตอนใหม่ (ดู docs/runbook.md)
        </p>
      )}
      {published && !batch.legacy && (
        <p className="rounded-xl border border-ok-line bg-ok-bg px-5 py-4 text-sm text-ok-ink">
          รอบนี้เผยแพร่อยู่ — ผู้ปกครองค้นเจอแล้ว ถ้าต้องอัปไฟล์หรือแก้ไขอะไร ให้กด
          &ldquo;ยกเลิกการเผยแพร่&rdquo; ด้านล่างก่อน แล้วกดเผยแพร่อีกครั้งเมื่อแก้เสร็จ
        </p>
      )}

      {running && !timelineShowsActiveJob && (
        <ProgressBanner job={view.activeJob} />
      )}
      {view.systemFailure && !running && (
        <div className="rounded-xl border border-danger-line bg-danger-bg px-5 py-4 text-sm text-danger-ink">
          <p className="font-medium">ประมวลผลล้มเหลว</p>
          <p className="mt-1">{view.systemFailure}</p>
          <p className="mt-2">ถ้าแก้เองไม่ได้ ให้ดู docs/runbook.md หรือส่งข้อความนี้ให้ผู้ดูแลระบบ</p>
        </div>
      )}

      {batch.legacy ? (
        <LegacyOverview
          batchId={batch.id}
          view={view}
          published={published}
          processing={view.processing}
          deleteInfo={deleteInfo}
          retention={retention}
          blockers={blockers}
        />
      ) : (
        <>
          <nav aria-label="ขั้นตอนนำเข้า" className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {steps.map((step) => {
              const current = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  aria-controls={`intake-step-${step.id}`}
                  aria-current={current ? "step" : undefined}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${current
                    ? "border-2 border-brand bg-brand-soft text-brand"
                    : "border-hairline bg-card text-ink-soft hover:border-brand-line hover:text-ink"
                    }`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${current ? "bg-brand text-white" : "bg-paper text-ink-soft"
                      }`}
                  >
                    {current ? step.id : step.done ? "✓" : step.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{step.title}</span>
                    <span className="block text-xs opacity-80">{step.detail}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <section id="intake-step-1" aria-label="ขั้นที่ 1 รายชื่อผู้เข้าสอบ" hidden={activeStep !== 1}>
            <RosterPanel
              batchId={batch.id}
              hasRoster={hasRoster}
              activeRoster={roster.active}
              totals={roster.totals}
              draft={roster.draft}
              locked={locked}
              footer={<StepNavigation label="ไปอัปโหลด ZIP →" onClick={() => setActiveStep(2)} />}
            />
          </section>

          <section id="intake-step-2" aria-label="ขั้นที่ 2 ZIP และจับคู่" hidden={activeStep !== 2}>
            <CertificatesPanel
              batchId={batch.id}
              profileKey={batch.profileKey}
              catalog={view.catalog}
              levelSubfolder={levelSubfolder}
              uploads={view.uploads}
              activeJob={view.activeJob}
              hasRoster={hasRoster}
              locked={locked}
              footer={<StepNavigation backLabel="← กลับไปขั้นรายชื่อ" onBack={() => setActiveStep(1)} label="ไปภาพรวมรอบนี้ →" onClick={() => setActiveStep(3)} />}
            />
          </section>

          <section id="intake-step-3" aria-label="ขั้นที่ 3 ภาพรวมรอบนี้" hidden={activeStep !== 3} className="rounded-[18px] border border-hairline bg-card p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">ภาพรวมรอบนี้</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {batch.programCode} · {batch.round === "HEAT" ? "รอบคัดเลือก" : "รอบชิงชนะเลิศ"} · {batch.year} · สรุปยอด รายการค้าง และการเผยแพร่
                </p>
              </div>
              <StatusBadge status={batch.status} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewMetric tone="brand" label="ผู้เข้าสอบทั้งหมด" value={`${formatCount(roster.totals.total)} คน`} detail={`Online ${formatCount(roster.totals.online)} · Onsite ${formatCount(roster.totals.onsite)}`} />
              <OverviewMetric tone="ok" label="เกียรติบัตรพร้อมเผยแพร่" value={view.processing ? "กำลังตรวจ" : `${formatCount(view.publish.summary.toPublish.certificates)} ใบ`} />
              <OverviewMetric tone="warn" label="รอแอดมินตัดสิน" value={view.processing ? "กำลังตรวจ" : `${formatCount(view.issues.length + view.missing.length)} รายการ`} detail={view.processing ? "ผลจะอัปเดตหลังงานเสร็จ" : `หน้าเกียรติบัตร ${formatCount(view.issues.length)} · ผู้เข้าสอบขาดไฟล์ ${formatCount(view.missing.length)}`} />
              <OverviewMetric label="เกียรติบัตรที่เผยแพร่แล้ว" value={`${formatCount(view.publish.publishedCount)} ใบ`} />
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">รายการที่ต้องจัดการ</h3>
                  {!view.processing && view.issues.length + view.missing.length > 0 && (
                    <span className="rounded-full border border-warn-line bg-warn-bg px-3 py-1 text-xs font-semibold text-warn-ink">
                      {formatCount(view.issues.length + view.missing.length)} ค้าง
                    </span>
                  )}
                </div>
                {view.processing ? (
                  <div className="mt-3"><WaitNotice /></div>
                ) : view.issues.length === 0 && view.missing.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-hairline bg-paper px-4 py-3 text-sm text-ink-soft">ไม่มีรายการค้างในตอนนี้</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {view.issues.length > 0 && (
                      <OverviewAction title="หน้าเกียรติบัตรที่ต้องตัดสิน" count={`${formatCount(view.issues.length)} หน้า`} hint="ตรวจชื่อและเลขผู้เข้าสอบก่อนยืนยันการจับคู่" actionLabel="เปิดรายการตรวจ" onClick={() => setReviewPanel("issues")} />
                    )}
                    {view.missing.length > 0 && (
                      <OverviewAction title="ผู้เข้าสอบยังไม่มีเกียรติบัตร" count={`${formatCount(view.missing.length)} คน`} hint="เลือกรางวัลและเพิ่ม PDF หรือปล่อยค้างไว้ก่อน" actionLabel="ดูผู้เข้าสอบที่ขาดไฟล์" onClick={() => setReviewPanel("missing")} />
                    )}
                  </div>
                )}
                {!view.processing && reviewPanel === "issues" && view.issues.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-hairline p-4" aria-label="รายการหน้าเกียรติบัตรที่ต้องตัดสิน">
                    <button type="button" onClick={() => setReviewPanel(null)} className="mb-4 min-h-11 cursor-pointer text-sm font-medium text-brand underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand">← ปิดรายการตรวจ</button>
                    <IssueList batchId={batch.id} issues={view.issues} catalog={view.catalog} locked={editLocked} />
                  </div>
                )}
                {!view.processing && reviewPanel === "missing" && view.missing.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-hairline p-4" aria-label="ผู้เข้าสอบที่ขาดไฟล์เกียรติบัตร">
                    <button type="button" onClick={() => setReviewPanel(null)} className="mb-4 min-h-11 cursor-pointer text-sm font-medium text-brand underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand">← ปิดรายการผู้เข้าสอบ</button>
                    <MissingList batchId={batch.id} items={view.missing} catalog={view.catalog} locked={editLocked} />
                  </div>
                )}
                <p className="mt-4 text-sm text-ink-soft">เผยแพร่ได้เฉพาะผู้เข้าสอบที่ข้อมูลครบ ส่วนรายการค้างจะยังไม่เผยแพร่</p>
              </section>

              <aside className="space-y-3">
                <section className="rounded-2xl border border-hairline p-4">
                  <h3 className="mb-3 text-lg font-semibold">จัดการรอบนี้</h3>
                  <div className="space-y-3">
                    {hasRoster && (
                      <PublishPanel batchId={batch.id} published={published} legacy={false} processing={view.processing} policy={batch.multiAwardPolicy} needsDecision={view.publish.needsDecision} summary={view.publish.summary} certificateCount={view.publish.certificateCount} publishedCount={view.publish.publishedCount} compact />
                    )}
                    <RetentionPanel batchId={batch.id} expiresAt={retention.expiresAt} certificates={view.publish.certificateCount} deletedFiles={retention.deletedFiles} compact />
                    <SourcesPanel batchId={batch.id} clearedAt={batch.sourcesClearedAt} blockers={blockers} compact />
                    <DangerZone batchId={batch.id} confirmPhrase={deleteInfo.confirmPhrase} published={published} counts={deleteInfo.counts} siblingBatches={deleteInfo.siblingBatches} compact />
                  </div>
                </section>
                <section className="rounded-2xl border border-hairline p-4">
                  <h3 className="text-lg font-semibold">ไปยังหน้าอื่น</h3>
                  <OverviewLinks batchId={batch.id} />
                </section>
              </aside>
            </div>
            <div className="mt-5 border-t border-hairline pt-5">
              <StepNavigation backLabel="← กลับไปขั้นอัปโหลด ZIP" onBack={() => setActiveStep(2)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function LegacyOverview({
  batchId,
  view,
  published,
  processing,
  deleteInfo,
  retention,
  blockers,
}: {
  batchId: string;
  view: NonNullable<BatchView>;
  published: boolean;
  processing: boolean;
  deleteInfo: DeleteInfo;
  retention: RetentionInfo;
  blockers: string[] | null;
}) {
  return (
    <section aria-label="ภาพรวมรอบเดิม" className="space-y-5">
      <h2 className="font-semibold">ภาพรวมรอบนี้</h2>
      <PublishPanel
        batchId={batchId}
        published={published}
        legacy
        processing={processing}
        policy={view.batch.multiAwardPolicy}
        needsDecision={view.publish.needsDecision}
        summary={view.publish.summary}
        certificateCount={view.publish.certificateCount}
        publishedCount={view.publish.publishedCount}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2 rounded-2xl border border-hairline bg-card p-5">
          <h3 className="font-semibold">อายุการเก็บ</h3>
          <RetentionPanel batchId={batchId} expiresAt={retention.expiresAt} certificates={view.publish.certificateCount} deletedFiles={retention.deletedFiles} />
        </section>
        <section className="space-y-2 rounded-2xl border border-hairline bg-card p-5">
          <h3 className="font-semibold">ไฟล์ต้นฉบับ</h3>
          <SourcesPanel batchId={batchId} clearedAt={view.batch.sourcesClearedAt} blockers={blockers} />
        </section>
      </div>
      <OverviewLinks batchId={batchId} includeParticipants={false} />
      <DangerZone
        batchId={batchId}
        confirmPhrase={deleteInfo.confirmPhrase}
        published={published}
        counts={deleteInfo.counts}
        siblingBatches={deleteInfo.siblingBatches}
      />
    </section>
  );
}

function StepNavigation({
  backLabel,
  onBack,
  label,
  onClick,
}: {
  backLabel?: string;
  onBack?: () => void;
  label?: string;
  onClick?: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      {backLabel && onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 cursor-pointer rounded-xl border border-hairline bg-card px-4 text-sm font-medium text-ink-soft transition hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {backLabel}
        </button>
      ) : <span />}
      {label && onClick && (
        <button
          type="button"
          onClick={onClick}
          className="min-h-11 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {label}
        </button>
      )}
    </div>
  );
}

function OverviewMetric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "brand" | "ok" | "warn" }) {
  const colors = tone === "brand" ? "border-brand-line bg-brand-soft text-brand" : tone === "ok" ? "border-ok-line bg-ok-bg text-ok-ink" : tone === "warn" ? "border-warn-line bg-warn-bg text-warn-ink" : "border-hairline bg-card text-ink";
  return (
    <div className={`rounded-2xl border p-4 ${colors}`}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-2 text-xs text-ink-soft">{detail}</p>}
    </div>
  );
}

function OverviewAction({
  title,
  count,
  hint,
  actionLabel,
  onClick,
}: {
  title: string;
  count: string;
  hint: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full cursor-pointer rounded-2xl border border-warn-line bg-warn-bg/30 p-4 text-left transition duration-200 hover:border-brand-line hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{title}</span>
        <span className="shrink-0 text-sm font-semibold text-warn-ink">{count}</span>
      </span>
      <span className="mt-1 block text-sm text-ink-soft">{hint}</span>
      <span className="mt-3 inline-block rounded-xl border border-brand-line bg-card px-3 py-2 text-sm font-semibold text-brand">{actionLabel}</span>
    </button>
  );
}

function OverviewLinks({ batchId, includeParticipants = true }: { batchId: string; includeParticipants?: boolean }) {
  return (
    <nav className="mt-2 grid gap-2">
      {includeParticipants && (
        <Link
          href={`/admin/batches/${batchId}/participants`}
          className="flex min-h-11 items-center justify-between rounded-lg px-3 text-sm text-brand transition hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          ค้นหาและแก้ไขผู้เข้าสอบ <span aria-hidden="true">→</span>
        </Link>
      )}
      <Link
        href={`/admin/batches/${batchId}/history`}
        className="flex min-h-11 items-center justify-between rounded-lg px-3 text-sm text-brand transition hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        ประวัติการแก้ไขของรอบนี้ <span aria-hidden="true">→</span>
      </Link>
    </nav>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** ระหว่างประมวลผล ผลยังเปลี่ยนได้อีก ถ้าให้ตัดสินไปก่อน แอดมินจะตัดสินจากข้อมูลที่ยังไม่ครบ */
function WaitNotice() {
  return (
    <p className="rounded-xl border border-brand-line bg-brand-soft px-5 py-4 text-sm text-brand">
      กำลังประมวลผลอยู่ — รายการจะแสดงเมื่อเสร็จ
    </p>
  );
}

/** บอกว่ากำลังอยู่ขั้นไหนและไปถึงไหนแล้ว — รอนานแล้วไม่รู้ว่าค้างหรือยังเดินอยู่ คือสิ่งที่แย่ที่สุด */
function ProgressBanner({ job }: { job: NonNullable<BatchView>["activeJob"] }) {
  const stage = job ? (STAGE_LABEL[job.type] ?? "กำลังประมวลผล") : "กำลังประมวลผล";
  const waiting = job?.status === "QUEUED";
  const done = numberOf(job?.progress?.done);
  const total = numberOf(job?.progress?.total);
  const percent = done !== null && total ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <div className="rounded-2xl border border-brand-line bg-brand-soft px-5 py-4">
      <p className="text-sm font-medium text-brand">
        {waiting ? `รอคิว: ${stage}` : stage}
        {done !== null && total ? ` ${done} / ${total} หน้า` : "..."}
      </p>
      {percent !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-card">
          <div className="h-full bg-brand transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="mt-2 text-sm text-ink-soft">
        ทำงานอยู่ที่เซิร์ฟเวอร์ ปิดหน้านี้หรือเน็ตหลุดก็ไม่กระทบ กลับมาเปิดใหม่ได้ตลอด
      </p>
    </div>
  );
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
