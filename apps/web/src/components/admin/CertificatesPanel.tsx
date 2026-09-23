"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AwardDef } from "@/lib/certificate-catalog";
import type { UploadRecord } from "@/lib/batch-view";
import { postJson } from "./client-api";
import { StepHeader } from "./RosterPanel";
import { pageStatusLabel } from "./StatusBadge";
import { UploadDropzone } from "./UploadDropzone";

/**
 * ขั้นที่ 2: ZIP เกียรติบัตร — อัปได้หลายครั้ง แต่ละครั้งเติมเฉพาะที่ยังไม่มี
 *
 * โครงใน ZIP: online/<รางวัล>/*.pdf และ onsite/<รางวัล>/*.pdf (มีแบบเดียวก็ได้)
 * ระบบตรวจโครงสร้างทั้งไฟล์ก่อนแตะข้อมูล ผิดข้อเดียวคือไม่นำเข้าอะไรเลย และบอกปัญหาครบในครั้งเดียว
 */
export function CertificatesPanel({
  batchId,
  profileKey,
  catalog,
  levelSubfolder,
  uploads,
  hasRoster,
  locked,
}: {
  batchId: string;
  profileKey: string | null;
  catalog: AwardDef[];
  levelSubfolder: boolean;
  uploads: UploadRecord[];
  hasRoster: boolean;
  locked: string | null;
}) {
  const disabledReason = locked ?? (hasRoster ? null : "ต้องใช้รายชื่อผู้เข้าสอบก่อน จึงจะอัปเกียรติบัตรได้");

  return (
    <section className="rounded-xl border border-hairline bg-card p-5">
      <StepHeader
        step={2}
        done={uploads.some((u) => u.kind === "zip" && u.status === "DONE")}
        title="ไฟล์ ZIP เกียรติบัตร"
        description="อัปซ้ำได้เรื่อย ๆ — ใบที่รับไปแล้วไม่ถูกแตะ หน้าเดิมที่อัปซ้ำไม่เกิดรายการตรวจซ้ำ"
      />

      <details className="mb-4 rounded-lg bg-paper p-4 text-sm" open={!hasRoster || uploads.length === 0}>
        <summary className="cursor-pointer font-medium">โครงโฟลเดอร์ที่รับ ({profileKey})</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-card p-3 text-xs leading-relaxed">
          {[
            "online/<รางวัล>/ไฟล์.pdf",
            "onsite/<รางวัล>/ไฟล์.pdf",
            ...(levelSubfolder ? ["online/<รางวัล>/<ระดับชั้น>/ไฟล์.pdf   (รายการนี้มีโฟลเดอร์ระดับชั้นได้)"] : []),
          ].join("\n")}
        </pre>
        <p className="mt-2 text-ink-soft">
          มีโฟลเดอร์ครอบชั้นนอกได้ 1 ชั้น (เช่น <code>HKIMO/online/gold/…</code>) · ZIP เดียวมีทั้ง online และ
          onsite หรือแบบเดียวก็ได้
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

      <UploadDropzone
        batchId={batchId}
        kind="zip"
        accept="application/zip,.zip"
        label="เลือกไฟล์ ZIP เกียรติบัตร"
        disabled={Boolean(disabledReason)}
        disabledReason={disabledReason ?? undefined}
      />

      {uploads.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">ประวัติการอัป</h3>
          <ul className="space-y-3">
            {uploads.map((upload) => (
              <UploadCard key={upload.jobId} upload={upload} locked={locked} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
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
        <p className="mt-1 text-ink-soft">
          {STAT_LABELS.filter(([key]) => Number(stats[key]) > 0)
            .map(([key, label]) => `${label} ${stats[key]}`)
            .join(" · ") || "ไม่มีหน้าใหม่"}
        </p>
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
  files?: number;
  pages?: number;
  modes?: Record<string, { files: number; pages: number }>;
  awards?: Record<string, number>;
  unsupportedFiles?: string[];
  unsupportedCount?: number;
};

function PreflightSummary({ preflight }: { preflight: Preflight }) {
  const modes = Object.entries(preflight.modes ?? {});
  return (
    <div className="mt-1 text-ink-soft">
      {preflight.files ? (
        <p>
          ตรวจโครงสร้างผ่าน: {preflight.files} ไฟล์ {preflight.pages} หน้า
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
