"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AwardDef } from "@/lib/certificate-catalog";
import type { BatchView, UploadRecord } from "@/lib/batch-view";
import { postJson } from "./client-api";
import { pageStatusLabel } from "./StatusBadge";
import { UploadDropzone } from "./UploadDropzone";

/**
 * ขั้นที่ 2: ZIP เกียรติบัตร — อัปได้หลายครั้ง แต่ละครั้งเติมเฉพาะที่ยังไม่มี
 *
 * โครงใน ZIP: online/onsite/<รางวัล>/*.pdf หรือ <รางวัล>/*.pdf
 * ระบบตรวจโครงสร้างทั้งไฟล์ก่อนแตะข้อมูล ผิดข้อเดียวคือไม่นำเข้าอะไรเลย และบอกปัญหาครบในครั้งเดียว
 */
export function CertificatesPanel({
  batchId,
  profileKey,
  catalog,
  levelSubfolder,
  uploads,
  activeJob,
  hasRoster,
  locked,
  children,
  footer,
}: {
  batchId: string;
  profileKey: string | null;
  catalog: AwardDef[];
  levelSubfolder: boolean;
  uploads: UploadRecord[];
  activeJob: NonNullable<BatchView>["activeJob"];
  hasRoster: boolean;
  locked: string | null;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const disabledReason = locked ?? (hasRoster ? null : "ต้องใช้รายชื่อผู้เข้าสอบก่อน จึงจะอัปเกียรติบัตรได้");
  const latestZip = uploads.find((upload) => upload.kind === "zip");
  const zipJob = activeJob?.type === "SPLIT" && uploads[0]?.kind === "zip" ? activeJob : null;
  const timelineJob = zipJob ?? (activeJob?.type === "MATCH" ? activeJob : null);
  const preflight = (zipJob?.progress?.preflight ?? latestZip?.progress.preflight) as Preflight | undefined;
  const zipRunning = latestZip?.status === "QUEUED" || latestZip?.status === "RUNNING";

  return (
    <section className="rounded-[18px] border border-hairline bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">ขั้นที่ 2 · อัปโหลด ZIP เกียรติบัตร</h2>
          <p className="mt-1 text-sm text-ink-soft">ระบบตรวจโครงสร้าง ZIP ก่อน แล้วแยกหน้าและจับคู่กับรายชื่อ</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${zipRunning ? "border-brand-line bg-brand-soft text-brand" : "border-hairline bg-paper text-ink-soft"}`}>
          {zipRunning ? "กำลังประมวลผล" : latestZip?.status === "DONE" ? "นำเข้าแล้ว" : latestZip?.status === "FAILED" ? "ตรวจไฟล์อีกครั้ง" : "รอไฟล์ ZIP"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          {latestZip ? (
            <div className="h-full rounded-2xl border border-hairline p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="min-w-0 break-all">{latestZip.fileName ?? "ไฟล์ ZIP"}</strong>
                <span className="rounded-full border border-hairline bg-paper px-2.5 py-1 text-xs text-ink-soft">
                  {zipRunning ? "อัปโหลดแล้ว" : latestZip.status === "DONE" ? "นำเข้าแล้ว" : "ไม่ได้นำเข้า"}
                </span>
              </div>
              <p className="mt-1 text-ink-soft">อัปโหลดเมื่อ {new Date(latestZip.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</p>
              {latestZip.status === "FAILED" && latestZip.error && (
                <p className={`mt-2 rounded-xl px-3 py-2 ${latestZip.userError ? "bg-warn-bg text-warn-ink" : "bg-danger-bg text-danger-ink"}`}>{latestZip.error}</p>
              )}
              <UploadDropzone batchId={batchId} kind="zip" accept="application/zip,.zip" label="เลือก ZIP ใหม่" variant="button" disabled={Boolean(disabledReason)} disabledReason={disabledReason ?? undefined} />
            </div>
          ) : (
            <UploadDropzone batchId={batchId} kind="zip" accept="application/zip,.zip" label="เลือกไฟล์ ZIP เกียรติบัตร" helperText="รองรับ .zip · อัปซ้ำเพื่อเติมใบที่ยังไม่มีได้" disabled={Boolean(disabledReason)} disabledReason={disabledReason ?? undefined} />
          )}
        </div>
        <div className="rounded-2xl border border-hairline p-4 text-sm">
          <h3 className="font-semibold">ผลจาก ZIP</h3>
          <p className="mt-1 text-ink-soft">ตรวจโฟลเดอร์รางวัลและรูปแบบการสอบ</p>
          {preflight ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-hairline bg-paper px-2.5 py-1 text-xs text-ink-soft">
                  {Object.values(preflight.problemCounts ?? {}).some((count) => count > 0) ? "โครงสร้างมีปัญหา" : "โครงสร้างถูกต้อง"}
                </span>
                {preflight.awards && (
                  <span className="rounded-full border border-hairline bg-paper px-2.5 py-1 text-xs text-ink-soft">
                    {Object.keys(preflight.awards).length} โฟลเดอร์รางวัล
                  </span>
                )}
              </div>
              <PreflightSummary preflight={preflight} />
            </>
          ) : (
            <p className="mt-4 rounded-xl bg-paper px-4 py-5 text-ink-soft">ผลตรวจจะแสดงที่นี่หลังอัปโหลด ZIP</p>
          )}
        </div>
      </div>

      {latestZip && (
        <ProcessingTimeline latestZip={latestZip} activeJob={timelineJob} preflight={preflight} />
      )}

      {children && <div className="mt-6 border-t border-hairline pt-5">{children}</div>}

      <details className="mt-5 rounded-xl bg-paper p-4 text-sm">
        <summary className="cursor-pointer font-medium">โครงโฟลเดอร์ที่รับ ({profileKey})</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-card p-3 text-xs leading-relaxed">
          {[
            "<รางวัล>/ไฟล์.pdf                         (ใช้โหมดจากรายชื่อ)",
            "online/<รางวัล>/ไฟล์.pdf",
            "onsite/<รางวัล>/ไฟล์.pdf",
            ...(levelSubfolder ? ["online/<รางวัล>/<ระดับชั้น>/ไฟล์.pdf   (รายการนี้มีโฟลเดอร์ระดับชั้นได้)"] : []),
          ].join("\n")}
        </pre>
        <p className="mt-2 text-ink-soft">
          มีโฟลเดอร์ครอบชั้นนอกได้ 1 ชั้น (เช่น <code>HKIMO/online/gold/…</code>) · ZIP เดียวมีทั้ง online และ
          onsite หรือแบบเดียวก็ได้ · อย่าปนสองโครงใน ZIP เดียวกัน
        </p>
        <p className="mt-2 text-ink-soft">
          ถ้าแยกเฉพาะรางวัล ระบบใช้เลขบนใบหารายชื่อ ตรวจชื่อ แล้วใช้ Online/Onsite ตามรายชื่อ;
          เลขหรือชื่อที่ยืนยันไม่ได้จะรอให้แอดมินตรวจ
        </p>
        <p className="mt-2 text-ink-soft">ชื่อโฟลเดอร์รางวัลที่รอบนี้รับ (ไม่สนตัวพิมพ์เล็ก-ใหญ่):</p>
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          {catalog.map((a) => (
            <li key={a.code}>
              <b>{a.label}</b>
              {a.kind === "SUPPLEMENTAL" && <span className="text-ink-soft"> (รางวัลเสริม)</span>}:{" "}
              <span className="text-ink-soft">{a.folders.map((f) => f.toLowerCase()).join(", ")}</span>
            </li>
          ))}
        </ul>
      </details>

      {uploads.length > 0 && (
        <details className="mt-5 rounded-xl border border-hairline p-4">
          <summary className="cursor-pointer text-sm font-semibold">ประวัติการอัป ({uploads.length} ครั้ง)</summary>
          <ul className="space-y-3">
            {uploads.map((upload) => (
              <UploadCard key={upload.jobId} upload={upload} locked={locked} />
            ))}
          </ul>
        </details>
      )}
      {footer && <div className="mt-5 border-t border-hairline pt-5">{footer}</div>}
    </section>
  );
}

function ProcessingTimeline({
  latestZip,
  activeJob,
  preflight,
}: {
  latestZip: UploadRecord | undefined;
  activeJob: NonNullable<BatchView>["activeJob"];
  preflight: Preflight | undefined;
}) {
  const jobStage = activeJob?.type === "SPLIT" ? activeJob.progress?.stage : latestZip?.progress.stage;
  const matching = Boolean(activeJob) && (jobStage === "match" || activeJob?.type === "MATCH");
  const splitDone = latestZip?.status === "DONE" || jobStage === "match" || activeJob?.type === "MATCH";
  const splitError = latestZip?.status === "FAILED" && jobStage === "split";
  const matchError = latestZip?.status === "FAILED" && jobStage === "match";
  const zipDone = latestZip?.status === "DONE" || Boolean(preflight) && !Object.values(preflight?.problemCounts ?? {}).some((count) => count > 0);
  const splitTotal = numberValue(preflight?.pages) ?? (jobStage === "split" ? numberValue(activeJob?.progress?.total) : null);
  const splitRead = splitDone ? splitTotal : jobStage === "split" ? numberValue(activeJob?.progress?.done ?? latestZip?.progress.done) : null;
  const matchTotal = matching || matchError ? numberValue(activeJob?.progress?.total ?? latestZip?.progress.total) : null;
  const matchRead = matching || matchError ? numberValue(activeJob?.progress?.done ?? latestZip?.progress.done) : null;

  return (
    <div className="mt-6">
      <h3 className="mb-3 font-semibold">กำลังทำอะไรอยู่</h3>
      <div className="space-y-3">
        <TimelineRow number={1} title="ตรวจ ZIP และโฟลเดอร์" detail="ตรวจชื่อโฟลเดอร์รางวัลและโครงสร้าง ZIP" state={zipDone ? "done" : latestZip?.status === "FAILED" ? "error" : latestZip?.status === "QUEUED" ? "pending" : "current"} statusText={latestZip?.status === "QUEUED" ? "รอคิว" : undefined} />
        <TimelineRow number={2} title="แยกหน้าเกียรติบัตร" detail="อ่าน PDF ทีละไฟล์" state={splitDone ? "done" : splitError ? "error" : jobStage === "split" ? "current" : "pending"} done={splitRead} total={splitTotal} />
        <TimelineRow number={3} title="จับคู่ชื่อกับรายชื่อ" detail="ตรวจเลขผู้เข้าสอบ ชื่อ และรูปแบบสอบ" state={matchError ? "error" : matching ? "current" : latestZip?.status === "DONE" ? "done" : "pending"} done={matchRead} total={matchTotal} />
      </div>
      {(latestZip?.status === "RUNNING" || matching) && (
        <p className="mt-4 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand">ระบบกำลังทำงานอยู่ ปิดหน้านี้แล้วกลับมาดูผลภายหลังได้</p>
      )}
    </div>
  );
}

function TimelineRow({ number, title, detail, state, done, total, statusText }: {
  number: number;
  title: string;
  detail: string;
  state: "pending" | "current" | "done" | "error";
  done?: number | null;
  total?: number | null;
  statusText?: string;
}) {
  const percent = total && done !== null && done !== undefined ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className={`rounded-2xl border p-4 ${state === "current" ? "border-brand-line bg-brand-soft/30" : state === "error" ? "border-danger-line bg-danger-bg/30" : "border-hairline bg-card"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 font-semibold">
          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${state === "current" ? "bg-brand text-white" : state === "error" ? "bg-danger-bg text-danger-ink" : "bg-paper text-ink-soft"}`}>
            {state === "done" ? "✓" : number}
          </span>
          {title}
        </div>
        <span className={`text-sm font-semibold tabular-nums ${state === "error" ? "text-danger-ink" : "text-ink-soft"}`}>
          {statusText ?? (total !== null && total !== undefined && done !== null && done !== undefined
            ? `${done.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} ใบ`
            : state === "done" ? "เสร็จแล้ว" : state === "error" ? "ตรวจไม่ผ่าน" : state === "current" ? "กำลังตรวจ" : "รอขั้นก่อนหน้า")}
        </span>
      </div>
      {percent !== null && state === "current" && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-line" role="progressbar" aria-label={title} aria-valuenow={done ?? 0} aria-valuemin={0} aria-valuemax={total ?? 0}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-ink-soft">{detail}</p>
    </div>
  );
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const STAT_LABELS: [string, string][] = [
  ["pagesRead", "หน้าที่อ่าน"],
  ["newPages", "หน้าใหม่"],
  ["skippedAccepted", "ข้าม (มีใบแล้ว)"],
  ["recognized", "ข้าม (หน้าเดิมที่เคยอัป)"],
  ["superseded", "แทนหน้าที่ติดปัญหา"],
  ["foreignSkipped", "ต่างชาติ (ข้าม)"],
  ["nationalityUnverified", "รอยืนยันสัญชาติ"],
  ["parseReview", "รอบ/ปีไม่ตรง"],
  ["awardTextMismatch", "ข้อความรางวัลไม่ตรงโฟลเดอร์"],
];

function UploadCard({ upload, locked }: { upload: UploadRecord; locked: string | null }) {
  const preflight = (upload.progress.preflight ?? null) as Preflight | null;
  const stats = upload.progress;
  const byMode = (stats.byMode ?? {}) as Record<string, number>;
  const running = upload.status === "QUEUED" || upload.status === "RUNNING";
  const title = upload.fileName ?? (upload.kind === "single" ? "PDF รายคน" : "ไฟล์ ZIP");
  const livePages = Object.entries(upload.pages).filter(([status]) => !["DISCARDED", "SUPERSEDED"].includes(status));

  return (
    <li className="rounded-lg border border-hairline p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {upload.kind === "single" && <span className="text-ink-soft">PDF รายคน · </span>}
          {title}
        </span>
        <span className="text-ink-soft">
          {new Date(upload.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
          {" · "}
          {running ? "กำลังประมวลผล" : upload.status === "DONE" ? "นำเข้าแล้ว" : "ไม่ได้นำเข้า"}
        </span>
      </div>

      {preflight && <PreflightSummary preflight={preflight} />}

      {upload.status === "DONE" && (
        <>
          <p className="mt-1 text-ink-soft">
            {STAT_LABELS.filter(([key]) => Number(stats[key]) > 0)
              .map(([key, label]) => `${label} ${stats[key]}`)
              .join(" · ") || "ไม่มีหน้าใหม่"}
          </p>
          {preflight?.layout === "AWARD_ONLY" && Object.keys(byMode).length > 0 && (
            <p className="mt-1 text-ink-soft">
              โหมดจากรายชื่อ: Online {byMode.ONLINE ?? 0} หน้า · Onsite {byMode.ONSITE ?? 0} หน้า
            </p>
          )}
        </>
      )}

      {upload.status === "FAILED" && upload.error && (
        <pre
          className={`mt-2 whitespace-pre-wrap rounded-lg px-3 py-2 font-sans ${
            upload.userError ? "bg-warn-bg text-warn-ink" : "bg-danger-bg text-danger-ink"
          }`}
        >
          {upload.userError ? upload.error : `ระบบประมวลผลไม่สำเร็จ: ${upload.error}`}
        </pre>
      )}

      {livePages.length > 0 && (
        <p className="mt-1 text-ink-soft">
          ตอนนี้: {livePages.map(([status, n]) => `${pageStatusLabel(status)} ${n}`).join(" · ")}
        </p>
      )}

      {upload.kind === "zip" && upload.status === "DONE" && livePages.length > 0 && !locked && (
        <DiscardUpload jobId={upload.jobId} fileName={upload.fileName} />
      )}
    </li>
  );
}

type Preflight = {
  layout?: "MODE_AWARD" | "AWARD_ONLY";
  files?: number;
  pages?: number;
  modes?: Record<string, { files: number; pages: number }>;
  awards?: Record<string, number>;
  unsupportedFiles?: string[];
  unsupportedCount?: number;
  problemCounts?: Record<string, number>;
};

function PreflightSummary({ preflight }: { preflight: Preflight }) {
  const modes = Object.entries(preflight.modes ?? {});
  const failed = Object.values(preflight.problemCounts ?? {}).some((count) => count > 0);
  return (
    <div className="mt-1 text-ink-soft">
      {preflight.files ? (
        <p>
          {failed ? "ตรวจโครงสร้างไม่ผ่าน" : "ตรวจโครงสร้างผ่าน"}: {preflight.files} ไฟล์ {preflight.pages} หน้า
          {preflight.layout === "AWARD_ONLY" && " · โหมดอ้างจากรายชื่อ"}
          {modes.length > 0 && ` (${modes.map(([m, v]) => `${m === "ONLINE" ? "Online" : "Onsite"} ${v.pages} หน้า`).join(", ")})`}
          {preflight.awards &&
            ` · ${Object.entries(preflight.awards)
              .map(([award, n]) => `${award} ${n}`)
              .join(", ")}`}
        </p>
      ) : null}
      {(preflight.unsupportedCount ?? 0) > 0 && (
        <p className="text-warn-ink">
          ไฟล์ที่ไม่ใช่ PDF ไม่ถูกนำเข้า {preflight.unsupportedCount} ไฟล์ เช่น{" "}
          {(preflight.unsupportedFiles ?? []).join(", ")} — ถ้าเป็นเกียรติบัตร ต้องแปลงเป็น PDF ก่อน
        </p>
      )}
    </div>
  );
}

/** ทิ้งทุกหน้าจากไฟล์นี้ — ใช้เมื่ออัป ZIP ผิดชุด ต้องพิมพ์ชื่อไฟล์ยืนยัน */
function DiscardUpload({ jobId, fileName }: { jobId: string; fileName: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!fileName) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 cursor-pointer text-sm text-ink-soft underline transition duration-200 hover:text-danger-ink"
      >
        อัปไฟล์นี้ผิด — ทิ้งทุกหน้าจากไฟล์นี้
      </button>
    );
  }

  async function discard() {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/admin/uploads/${jobId}/discard`, { confirm: typed });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="mt-2 rounded-lg border border-danger-line bg-danger-bg p-3">
      <p className="text-danger-ink">
        ทุกหน้าจากไฟล์นี้ (รวมใบที่จับคู่แล้ว) จะถูกทิ้ง — ยังเก็บไว้เป็นหลักฐานและคืนทีละหน้าได้
        พิมพ์ชื่อไฟล์ <b>{fileName}</b> เพื่อยืนยัน
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-danger-line bg-card px-3 py-2"
        />
        <button
          type="button"
          onClick={discard}
          disabled={busy || typed.trim() !== fileName}
          className="min-h-10 cursor-pointer rounded-xl bg-danger-ink px-3 text-white transition duration-200 disabled:opacity-40"
        >
          {busy ? "กำลังทิ้ง..." : "ทิ้งทุกหน้า"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-10 cursor-pointer rounded-xl border border-hairline bg-card px-3 transition duration-200"
        >
          ยกเลิก
        </button>
      </div>
      {error && <p className="mt-2 text-danger-ink">{error}</p>}
    </div>
  );
}
