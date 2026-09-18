"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AWARD_LABELS } from "@/lib/normalize";
import type { MissingItem } from "@/lib/missing";

/**
 * รายการที่ต้องตามเก็บ — คนละบล็อก โยนไฟล์ PDF เข้าไปในบล็อกของคนนั้นได้เลย
 *
 * ไม่ต้องสร้างโฟลเดอร์ ไม่ต้องอัด ZIP ไม่ต้องเลือกรางวัล เพราะระบบรู้อยู่แล้วว่า
 * บล็อกนี้เป็นของใครและขาดอะไร แล้วจะตรวจให้ด้วยว่าไฟล์ที่โยนเข้ามาเป็นของคนนั้นจริง
 */
export function MissingList({ batchId, items }: { batchId: string; items: MissingItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-1 font-semibold">รายการที่ต้องตามเก็บ ({items.length} คน)</h2>
      <p className="mb-4 text-sm text-gray-500">
        ขอไฟล์จากต้นทางแล้วโยนเข้ามาในบล็อกของคนนั้นได้เลย ระบบจะตั้งชื่อไฟล์
        สร้างรูปตัวอย่าง และจับคู่ให้เอง
        <br />
        ต้นทางส่งมาเป็นไฟล์รวมหลายหน้าก็โยนเข้ามาได้ ระบบจะคัดเฉพาะหน้าของคนนี้ออกมาใบเดียว
        หน้าของคนอื่นในไฟล์จะไม่ถูกนำเข้า
      </p>

      <div className="space-y-3">
        {items.map((item) => (
          <MissingCard key={item.certNo} batchId={batchId} item={item} />
        ))}
      </div>
    </section>
  );
}

function MissingCard({ batchId, item }: { batchId: string; item: MissingItem }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setNote(null);
    setProgress(0);

    try {
      const urlRes = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId, kind: "missing-pdf" }),
      });
      if (!urlRes.ok) throw new Error((await urlRes.json()).error ?? "ขอลิงก์อัปโหลดไม่สำเร็จ");
      const { url, key, contentType } = await urlRes.json();

      await putWithProgress(url, file, contentType, setProgress);

      const res = await fetch(`/api/admin/batches/${batchId}/missing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, certNo: item.certNo }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "รับไฟล์ไม่สำเร็จ");
      const { jobId } = await res.json();

      // ต้องรอผลจริง ไม่ใช่จบที่ "อัปโหลดขึ้นแล้ว"
      // เพราะการตรวจว่าไฟล์เป็นของคนนี้จริงเกิดทีหลัง ถ้าไม่รอ แอดมินจะไม่รู้ว่าถูกปฏิเสธ
      setProgress(null);
      setWorking(true);
      const result = await waitForJob(jobId);
      setWorking(false);

      if (result.error) setError(result.error);
      else {
        // บอกว่าใช้หน้าไหนของไฟล์ที่อัปมา เมื่อไฟล์นั้นมีหลายหน้า
        setNote(result.note);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
      setProgress(null);
      setWorking(false);
    }
  }

  const uploading = progress !== null;
  const busy = uploading || working;

  return (
    <article className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">{item.name}</h3>
        <span className="text-sm text-gray-500">เลข {item.certNo}</span>
      </div>
      <p className="mt-1 text-sm text-amber-800">{item.reason}</p>
      <p className="mt-1 text-sm text-gray-600">
        ไฟล์ที่ขาด: <b>{AWARD_LABELS[item.expectedAward] ?? item.expectedAward}</b>
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-3 w-full rounded-lg border-2 border-dashed border-amber-300 px-4 py-4 text-sm
                   text-amber-800 transition hover:border-amber-500 disabled:opacity-50"
      >
        {uploading
          ? `กำลังอัปโหลด... ${progress}%`
          : working
            ? "กำลังตรวจไฟล์และประมวลผล..."
            : "เลือกไฟล์ PDF ที่ได้มาใหม่"}
      </button>

      {uploading && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-100">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {(error ?? item.lastError) && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ไม่รับไฟล์นี้ — {error ?? item.lastError}
        </p>
      )}

      {note && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{note}</p>
      )}
    </article>
  );
}

type JobResult = { error: string | null; note: string | null };

/** รอจนกว่างานเบื้องหลังจะจบ แล้วคืนข้อความผิดพลาด (ถ้ามี) พร้อมหมายเหตุของงาน */
async function waitForJob(jobId: string, timeoutMs = 180_000): Promise<JobResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`/api/admin/jobs/${jobId}`);
    if (!res.ok) continue;

    const job = await res.json();
    if (job.status === "DONE") return { error: null, note: readNote(job.progress) };
    if (job.status === "FAILED") {
      return { error: job.error ?? "ประมวลผลไม่สำเร็จ", note: null };
    }
  }
  return { error: "ใช้เวลานานผิดปกติ ลองรีเฟรชหน้าเพื่อดูผลอีกครั้ง", note: null };
}

/** หมายเหตุที่ worker ฝากไว้ว่าใช้หน้าไหนของไฟล์ที่อัปมา — มีเฉพาะเมื่อไฟล์นั้นหลายหน้า */
function readNote(progress: unknown): string | null {
  const note = (progress as { singlePdf?: { note?: unknown } })?.singlePdf?.note;
  return typeof note === "string" ? note : null;
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // ต้องตรงกับ contentType ที่ใช้ตอน sign ไม่งั้น R2 จะปฏิเสธลายเซ็น
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`อัปโหลดไม่สำเร็จ (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("เชื่อมต่อที่เก็บไฟล์ไม่ได้"));
    xhr.send(file);
  });
}
