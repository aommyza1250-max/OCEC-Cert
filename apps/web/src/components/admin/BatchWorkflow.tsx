"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { BatchView } from "@/lib/batch-view";
import { AuditTrail } from "./AuditTrail";
import { CertificatesPanel } from "./CertificatesPanel";
import { IssueList } from "./IssueList";
import { MissingList } from "./MissingList";
import { PublishPanel } from "./PublishPanel";
import { RosterPanel } from "./RosterPanel";

/** ชื่อขั้นตอนที่แอดมินเข้าใจ — แยกให้ชัดว่ากำลังทำอะไรอยู่ ไม่ใช่ "กำลังประมวลผล" ลอย ๆ */
const STAGE_LABEL: Record<string, string> = {
  SPLIT: "กำลังตรวจ ZIP ตัดแยกหน้า และจับคู่",
  MATCH: "กำลังจับคู่กับรายชื่อใหม่",
  ROSTER_VALIDATE: "กำลังตรวจไฟล์รายชื่อ",
  ROSTER_ACTIVATE: "กำลังเปลี่ยนรายชื่อและจับคู่ใหม่ทั้งรอบ",
  CLEANUP_SOURCES: "กำลังเคลียร์ไฟล์ต้นฉบับ",
  DELETE_BATCH: "กำลังลบรอบการนำเข้า",
};

/**
 * ขั้นตอนนำเข้าทั้งหมดของรอบนี้บนหน้าเดียว:
 *   1. รายชื่อ (ต้องมาก่อน)  2. ZIP เกียรติบัตร  3. ตัดสินหน้าที่ติดปัญหา / ตามเก็บไฟล์ที่ขาด  4. เผยแพร่
 */
export function BatchWorkflow({ view, levelSubfolder }: { view: NonNullable<BatchView>; levelSubfolder: boolean }) {
  const router = useRouter();
  const { batch, roster } = view;
  const published = batch.status === "PUBLISHED";
  const draftBusy = roster.draft?.status === "PENDING" || roster.draft?.status === "ACTIVATING";
  const running = view.processing || draftBusy || batch.status === "DELETING";

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
  const hasRoster = Boolean(roster.active);

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

      {running && <ProgressBanner job={view.activeJob} />}
      {view.systemFailure && !running && (
        <div className="rounded-xl border border-danger-line bg-danger-bg px-5 py-4 text-sm text-danger-ink">
          <p className="font-medium">ประมวลผลล้มเหลว</p>
          <p className="mt-1">{view.systemFailure}</p>
          <p className="mt-2">ถ้าแก้เองไม่ได้ ให้ดู docs/runbook.md หรือส่งข้อความนี้ให้ผู้ดูแลระบบ</p>
        </div>
      )}

      {!batch.legacy && (
        <>
          <RosterPanel
            batchId={batch.id}
            hasRoster={hasRoster}
            totals={roster.totals}
            draft={roster.draft}
            locked={locked}
          />
          <CertificatesPanel
            batchId={batch.id}
            profileKey={batch.profileKey}
            catalog={view.catalog}
            levelSubfolder={levelSubfolder}
            uploads={view.uploads}
            hasRoster={hasRoster}
            locked={locked}
          />
        </>
      )}

      {hasRoster && (
        <>
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">หน้าที่ต้องตัดสิน</h2>
              <Link
                href={`/admin/batches/${batch.id}/participants`}
                className="text-sm text-brand underline underline-offset-2"
              >
                ค้นหาและแก้ไขผู้เข้าสอบ →
              </Link>
            </div>
            {view.processing ? (
              <WaitNotice />
            ) : (
              <IssueList batchId={batch.id} issues={view.issues} catalog={view.catalog} locked={editLocked} />
            )}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">ผู้เข้าสอบที่ยังไม่มีเกียรติบัตร</h2>
            {view.processing ? (
              <WaitNotice />
            ) : (
              <MissingList batchId={batch.id} items={view.missing} catalog={view.catalog} locked={editLocked} />
            )}
          </section>
        </>
      )}

      {(hasRoster || batch.legacy) && (
        <PublishPanel
          batchId={batch.id}
          published={published}
          legacy={batch.legacy}
          processing={view.processing}
          policy={batch.multiAwardPolicy}
          needsDecision={view.publish.needsDecision}
          summary={view.publish.summary}
          certificateCount={view.publish.certificateCount}
          publishedCount={view.publish.publishedCount}
        />
      )}

      {view.audit.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">การแก้ไขล่าสุด</h2>
          <AuditTrail events={view.audit} />
        </section>
      )}
    </div>
  );
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
