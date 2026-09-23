"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { AwardDef } from "@/lib/certificate-catalog";
import type { MissingItem } from "@/lib/batch-view";
import { HOLD_LABELS } from "@/lib/publish-rules";
import { postJson, uploadFile, waitForJob } from "./client-api";

/**
 * ผู้เข้าสอบที่ยังขาดไฟล์ — แยก online/onsite
 *
 * โยน PDF เข้าไปในบล็อกของคนนั้นได้เลย (ไฟล์รวมเล่มก็ได้ ระบบคัดเฉพาะหน้าของคนนี้ออกมา)
 * แต่ **ต้องเลือกรางวัลเอง** — ระบบไม่เดารางวัลจากข้อความบนหน้าหรือจาก Excel
 * ช่องรางวัลใน Excel แสดงไว้เป็นข้อมูลประกอบเท่านั้น
 */
export function MissingList({
  batchId,
  items,
  catalog,
  locked,
}: {
  batchId: string;
  items: MissingItem[];
  catalog: AwardDef[];
  locked: string | null;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-ok-line bg-ok-bg px-5 py-4 text-sm text-ok-ink">
        ผู้เข้าสอบทุกคนในรายชื่อมีเกียรติบัตรแล้ว
      </p>
    );
  }

  const byMode = (mode: string) => items.filter((i) => i.examMode === mode);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        ยังขาดไฟล์ {items.length} คน — Online {byMode("ONLINE").length} · Onsite {byMode("ONSITE").length}
      </p>
      {(["ONLINE", "ONSITE"] as const).map((mode) =>
        byMode(mode).length === 0 ? null : (
          <details key={mode} open={byMode(mode).length <= 30} className="rounded-xl border border-warn-line bg-card">
            <summary className="cursor-pointer px-4 py-3 font-medium">
              {mode === "ONLINE" ? "Online" : "Onsite"} ({byMode(mode).length} คน)
            </summary>
            <div className="space-y-3 border-t border-hairline p-3">
              {byMode(mode).map((item) => (
                <MissingCard key={item.id} batchId={batchId} item={item} catalog={catalog} locked={locked} />
              ))}
            </div>
          </details>
        ),
      )}
    </div>
  );
}

function MissingCard({
  batchId,
  item,
  catalog,
  locked,
}: {
  batchId: string;
  item: MissingItem;
  catalog: AwardDef[];
  locked: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [award, setAward] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // รางวัลที่คนนี้ยังไม่มี — มีแล้วต้องใช้ปุ่มเปลี่ยนไฟล์ที่หน้าแก้ไขแทน
  const options = catalog.filter((a) => !item.awards.includes(a.code));

  async function handleFile(file: File) {
    setError(null);
    setNote(null);
    setProgress(0);
    try {
      const key = await uploadFile(batchId, "pdf", file, setProgress);
      setProgress(null);
      setWorking(true);
      const result = await postJson<{ jobId: string }>(`/api/admin/participants/${item.id}/certificates`, {
        key,
        fileName: file.name,
        awardCode: award,
        purpose: "add",
      });
      if (!result.ok) throw new Error(result.error);
      // ต้องรอผลจริง ไม่ใช่จบที่ "อัปโหลดขึ้นแล้ว" — การตรวจว่าไฟล์เป็นของคนนี้เกิดทีหลัง
      const job = await waitForJob(result.jobId);
      if (job.error) setError(job.error);
      else {
        const single = (job.progress?.singlePdf ?? {}) as { note?: string };
        setNote(single.note ?? null);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setProgress(null);
      setWorking(false);
    }
  }

  const busy = progress !== null || working;

  return (
    <article className="rounded-lg border border-warn-line bg-warn-bg p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={`/admin/batches/${batchId}/participants/${item.id}`}
          className="font-semibold underline-offset-2 hover:underline"
        >
          {item.name}
        </Link>
        <span className="text-ink-soft">เลข {item.candidateNo}</span>
        {item.level && <span className="text-ink-soft">{item.level}</span>}
        {item.school && <span className="text-ink-soft">{item.school}</span>}
      </div>
      <p className="mt-1 text-warn-ink">{HOLD_LABELS[item.reason]}</p>
      <p className="mt-1 text-ink-soft">
        {item.rawAward ? `รางวัลตาม Excel: ${item.rawAward}` : "Excel ไม่ได้ระบุรางวัล"}
        {item.awards.length > 0 && ` · มีใบแล้ว: ${item.awards.join(", ")}`}
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={award}
          onChange={(e) => setAward(e.target.value)}
          disabled={busy || Boolean(locked)}
          className="rounded-lg border border-hairline bg-card px-2 py-2"
          aria-label="รางวัลของไฟล์ที่จะอัป"
        >
          <option value="">เลือกรางวัลของไฟล์นี้...</option>
          {options.map((a) => (
            <option key={a.code} value={a.code}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || !award || Boolean(locked)}
          className="min-h-10 cursor-pointer rounded-xl border-2 border-dashed border-warn-line bg-card px-3
                     text-warn-ink transition duration-200 hover:border-warn-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {progress !== null
            ? `กำลังอัปโหลด... ${progress}%`
            : working
              ? "กำลังตรวจไฟล์และประมวลผล..."
              : "เลือกไฟล์ PDF ที่ได้มา"}
        </button>
      </div>

      {(error ?? item.lastError) && (
        <p className="mt-2 rounded-lg bg-danger-bg px-3 py-2 text-danger-ink">ไม่รับไฟล์นี้ — {error ?? item.lastError}</p>
      )}
      {note && <p className="mt-2 rounded-lg bg-ok-bg px-3 py-2 text-ok-ink">{note}</p>}
    </article>
  );
}
