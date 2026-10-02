"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Result = {
  total?: number;
  converted?: number;
  failed?: number;
  pendingCleanup?: number;
  cleanupCompleted?: number;
  bytesBefore?: number;
  bytesAfter?: number;
  unresolved?: number;
  failures?: { pageId: string; reason: string }[];
  dryRun?: boolean;
};

/** Remove this temporary control after every deployed batch has been migrated. */
export function WebpMigrationPanel({ batchId, processing }: { batchId: string; processing: boolean }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/jobs/${jobId}`);
        if (!response.ok) throw new Error("อ่านสถานะงานไม่สำเร็จ");
        const job = await response.json();
        if (job.status === "DONE" || job.status === "FAILED") {
          clearInterval(timer);
          setRunning(false);
          if (job.status === "FAILED") setError(job.error ?? "งานไม่สำเร็จ");
          else setResult(job.progress as Result);
          router.refresh();
        }
      } catch (cause) {
        clearInterval(timer);
        setRunning(false);
        setError(cause instanceof Error ? cause.message : "อ่านสถานะงานไม่สำเร็จ");
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [jobId, router]);

  async function queue(dryRun: boolean) {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/batches/${batchId}/migrate-webp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "เริ่มงานไม่สำเร็จ");
      setJobId(body.jobId);
      router.refresh();
    } catch (cause) {
      setRunning(false);
      setError(cause instanceof Error ? cause.message : "เริ่มงานไม่สำเร็จ");
    }
  }

  return (
    <section className="rounded-2xl border border-hairline bg-card p-4 text-sm">
      <h3 className="font-semibold">ย้ายรูปเก่าเป็น WebP คุณภาพปัจจุบัน</h3>
      <p className="mt-1 text-ink-soft">ตรวจจำนวนก่อน ระบบจะแปลง PDF ที่ยังเหลือหรือปรับขนาด WebP รุ่นเก่า แล้วตรวจรูป สลับไฟล์ และลบไฟล์เก่าที่เลิกใช้</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={running || processing} onClick={() => queue(true)} className="min-h-10 rounded-xl border border-brand-line px-3 font-medium text-brand disabled:opacity-50">ตรวจจำนวน</button>
        <button type="button" disabled={running || processing} onClick={() => queue(false)} className="min-h-10 rounded-xl bg-brand px-3 font-medium text-white disabled:opacity-50">เริ่มย้าย / ลองใหม่</button>
      </div>
      {running && <p className="mt-2 text-ink-soft">กำลังทำงาน…</p>}
      {result && <div className="mt-2 text-ink-soft">
        <p>{result.dryRun ? "รอย้าย" : "แปลงแล้ว"} {result.dryRun ? result.total ?? 0 : result.converted ?? 0} ใบ · ล้มเหลว {result.failed ?? 0} · รอลบไฟล์เก่า {result.pendingCleanup ?? 0} · หน้าที่ยังต้องจับคู่ {result.unresolved ?? 0}</p>
        {!result.dryRun && result.bytesAfter !== undefined && <p>ขนาดรูปหลังย้ายรวม {(result.bytesAfter / 1024 / 1024).toFixed(1)} MB จากไฟล์เดิม {(result.bytesBefore ?? 0) / 1024 / 1024 > 0 ? ((result.bytesBefore ?? 0) / 1024 / 1024).toFixed(1) : "?"} MB</p>}
        {result.failures?.map((failure) => <p key={failure.pageId} className="text-danger-ink">หน้า {failure.pageId}: {failure.reason}</p>)}
      </div>}
      {error && <p className="mt-2 text-danger-ink">{error}</p>}
    </section>
  );
}
