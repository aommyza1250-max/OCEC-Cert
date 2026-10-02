"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DiscardedAsset } from "@/lib/batch-view";
import { postJson, waitForJob } from "./client-api";
import { useConfirmDialog } from "./ConfirmDialog";

export function DiscardedFilesPanel({
  batchId,
  pages,
  total,
  pendingCleanup,
  locked,
}: {
  batchId: string;
  pages: DiscardedAsset[];
  total: number;
  pendingCleanup: number;
  locked: string | null;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function purge(page: DiscardedAsset) {
    if (!(await confirm(
      `ลบไฟล์ PDF และรูปของหน้า ${page.pageNumber} จาก R2 ถาวร?\nหลังสั่งลบ จะคืนหน้านี้ไม่ได้ และไฟล์ที่ลบจะกู้จากระบบไม่ได้`,
      { title: "ลบไฟล์ถาวร", confirmLabel: "ลบไฟล์ถาวร", tone: "danger" },
    ))) return;
    setBusyId(page.id);
    setMessage(null);
    const result = await postJson<{ jobId: string }>(`/api/admin/pages/${page.id}/resolve`, {
      action: "PURGE_FILES", version: page.version,
    });
    if (!result.ok) {
      setMessage(result.error);
      setBusyId(null);
      return;
    }
    router.refresh();
    const job = await waitForJob(result.jobId);
    const finalization = job.progress?.assetFinalization as { pendingCleanup?: number; failed?: boolean } | undefined;
    if (job.error || finalization?.failed || (finalization?.pendingCleanup ?? 0) > 0) {
      setMessage(job.error ?? "ระบบรับคำสั่งแล้ว แต่ยังลบไฟล์จาก R2 ไม่ครบ ระบบจะลองใหม่ในงานจับคู่ครั้งถัดไป");
    } else {
      setMessage(`ลบไฟล์ของหน้า ${page.pageNumber} เรียบร้อยแล้ว`);
    }
    setBusyId(null);
    router.refresh();
  }

  async function retry() {
    setBusyId("retry");
    setMessage(null);
    const result = await postJson<{ jobId: string }>(`/api/admin/batches/${batchId}/retry-asset-cleanup`, {});
    if (!result.ok) {
      setMessage(result.error);
      setBusyId(null);
      return;
    }
    const job = await waitForJob(result.jobId);
    const finalization = job.progress?.assetFinalization as { pendingCleanup?: number; failed?: boolean } | undefined;
    setMessage(job.error ?? (finalization?.failed || (finalization?.pendingCleanup ?? 0) > 0
      ? "ยังลบไฟล์จาก R2 ไม่ครบ กรุณาลองใหม่ภายหลัง"
      : "ลบไฟล์ที่ค้างเรียบร้อยแล้ว"));
    setBusyId(null);
    router.refresh();
  }

  if (total === 0 && pendingCleanup === 0) return null;
  return (
    <section className="mt-5 rounded-2xl border border-hairline bg-card p-4" aria-label="ไฟล์ของหน้าที่ทิ้งไว้">
      {dialog}
      <h3 className="text-lg font-semibold">ไฟล์ของหน้าที่ทิ้งไว้ ({total} หน้า)</h3>
      <p className="mt-1 text-sm text-ink-soft">การทิ้งหน้าจะเก็บไฟล์ไว้เพื่อคืนหน้าได้ หากแน่ใจว่าไม่ใช้แล้ว จึงค่อยลบไฟล์ถาวร</p>
      {pendingCleanup > 0 && <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-warn-ink">
        <span>มีงานลบไฟล์บน R2 ค้าง {pendingCleanup} รายการ</span>
        <button type="button" disabled={Boolean(locked) || busyId !== null} onClick={retry}
          className="min-h-11 cursor-pointer rounded-xl border border-warn-line px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          {busyId === "retry" ? "กำลังลองใหม่..." : "ลองลบไฟล์ที่ค้างอีกครั้ง"}
        </button>
      </div>}
      {message && <p role="status" className="mt-2 text-sm text-ink-soft">{message}</p>}
      {pages.length > 0 && (
        <ul className="mt-3 max-h-96 space-y-2 overflow-auto">
          {pages.map((page) => (
            <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-paper p-3 text-sm">
              <div className="min-w-0">
                <b>หน้า {page.pageNumber}</b>
                {page.certNo && <span> · เลข {page.certNo}</span>}
                {page.sourceFile && <p className="break-all text-ink-soft">{page.sourceFile}</p>}
                <p className="text-ink-soft">{[page.hasPdf && "PDF", page.hasPreview && "รูป"].filter(Boolean).join(" + ")}</p>
              </div>
              <button type="button" disabled={Boolean(locked) || busyId !== null} title={locked ?? undefined}
                onClick={() => purge(page)}
                className="min-h-11 cursor-pointer rounded-xl border border-danger-line bg-danger-bg px-4 font-semibold text-danger-ink disabled:cursor-not-allowed disabled:opacity-50">
                {busyId === page.id ? "กำลังลบ..." : "ลบไฟล์ถาวร"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > pages.length && <p className="mt-2 text-sm text-ink-soft">แสดง {pages.length} หน้าแรกจาก {total} หน้า รายการถัดไปจะแสดงเมื่อรายการก่อนหน้าถูกลบ</p>}
    </section>
  );
}
