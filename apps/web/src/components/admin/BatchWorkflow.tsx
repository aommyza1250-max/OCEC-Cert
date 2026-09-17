"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UploadDropzone } from "./UploadDropzone";

type Props = {
  batchId: string;
  status: string;
  hasZip: boolean;
  hasExcel: boolean;
  certificateCount: number;
  stats: Record<string, unknown>;
  counts: Record<string, number>;
  latestJob: { id: string; type: string; status: string; error: string | null } | null;
};

const RUNNING = new Set(["SPLITTING", "MATCHING"]);

export function BatchWorkflow(props: Props) {
  const router = useRouter();
  const running = RUNNING.has(props.status);

  // ระหว่าง worker ทำงานให้รีเฟรชหน้าเองทุก 3 วินาที แอดมินจะได้ไม่ต้องกด F5
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <div className="space-y-6">
      <StepCard
        step={1}
        title="อัปโหลดไฟล์ ZIP เกียรติบัตร"
        done={props.hasZip}
        description="ข้างใน ZIP ต้องแยกโฟลเดอร์ตามรางวัล (gold, silver, bronze, merit, perfect score) เพราะระบบอ่านรางวัลจากชื่อโฟลเดอร์"
      >
        <UploadDropzone batchId={props.batchId} kind="zip" accept="application/zip,.zip" />
      </StepCard>

      <StepCard
        step={2}
        title="อัปโหลดไฟล์รายชื่อ Excel"
        done={props.hasExcel}
        disabled={!props.hasZip || props.status === "SPLITTING"}
        description="ระบบจับคู่ด้วยเลขผู้เข้าสอบ (CANDIDATE NO) เป็นหลัก แล้วเทียบชื่อยืนยันอีกชั้น"
      >
        <UploadDropzone
          batchId={props.batchId}
          kind="excel"
          accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx"
        />
      </StepCard>

      {running && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800">
          กำลังประมวลผล... หน้านี้จะอัปเดตเองทุก 3 วินาที
        </p>
      )}

      {props.latestJob?.status === "FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="font-medium text-red-800">ประมวลผลล้มเหลว</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-red-700">
            {props.latestJob.error}
          </pre>
        </div>
      )}

      <StatsPanel stats={props.stats} counts={props.counts} />

      <PublishPanel
        batchId={props.batchId}
        status={props.status}
        certificateCount={props.certificateCount}
        unresolved={
          (props.counts.UNMATCHED ?? 0) +
          (props.counts.AMBIGUOUS ?? 0) +
          (props.counts.DUPLICATE_NAME ?? 0)
        }
      />
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  done,
  disabled,
  children,
}: {
  step: number;
  title: string;
  description: string;
  done: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 ${
        disabled ? "border-gray-200 opacity-50" : "border-gray-200"
      }`}
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-green-600 text-white" : "bg-gray-200 text-gray-600"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
      </div>
      {!disabled && children}
    </section>
  );
}

function StatsPanel({
  stats,
  counts,
}: {
  stats: Record<string, unknown>;
  counts: Record<string, number>;
}) {
  const items: { label: string; value: number | string }[] = [
    { label: "ไฟล์ใน ZIP", value: num(stats.bundles) },
    { label: "หน้าทั้งหมด", value: num(stats.pagesTotal) },
    { label: "ตัดแยกแล้ว", value: num(stats.pagesSplit) },
    { label: "ข้าม (ไม่ใช่คนไทย)", value: num(stats.foreignSkipped) },
    { label: "อ่านชื่อไม่ออก", value: num(stats.nameNotFound) },
    { label: "รางวัลบนหน้าไม่ตรงโฟลเดอร์", value: num(stats.awardMismatch) },
    { label: "รายชื่อใน Excel", value: num(stats.rosterRows) },
    { label: "จับคู่สำเร็จ", value: counts.MATCHED ?? num(stats.matched) },
    { label: "จับด้วยเลขผู้เข้าสอบ", value: num(stats.matchedByCertNo) },
    { label: "จับด้วยชื่อ", value: num(stats.matchedByName) },
    { label: "เลขตรงแต่ชื่อไม่ตรง", value: num(stats.nameMismatch) },
    { label: "รางวัลไม่ตรงกับ Excel", value: num(stats.awardMismatchWithRoster) },
    { label: "ระดับชั้นไม่ตรงกับ Excel", value: num(stats.levelMismatch) },
    { label: "ชื่อซ้ำ รอตัดสิน", value: counts.DUPLICATE_NAME ?? 0 },
    { label: "ยังไม่มีคู่", value: counts.UNMATCHED ?? 0 },
    { label: "ทิ้งเพราะซ้ำ", value: counts.DISCARDED ?? 0 },
  ];

  if (items.every((i) => i.value === "—")) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 font-semibold">สรุปผลการประมวลผล</h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-sm text-gray-500">{item.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {Array.isArray(stats.unmatchedRows) && stats.unmatchedRows.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-amber-700">
            รายชื่อใน Excel ที่ไม่มีหน้าเกียรติบัตร ({stats.unmatchedRows.length})
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm text-gray-600">
            {(stats.unmatchedRows as { row: number; certNo: string; name: string }[]).map((r) => (
              <li key={r.row}>
                แถวที่ {r.row} · เลข {r.certNo || "—"} · {r.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function num(value: unknown): number | string {
  return typeof value === "number" ? value : "—";
}

function PublishPanel({
  batchId,
  status,
  certificateCount,
  unresolved,
}: {
  batchId: string;
  status: string;
  certificateCount: number;
  unresolved: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const published = status === "PUBLISHED";

  async function toggle() {
    setBusy(true);
    await fetch(`/api/admin/batches/${batchId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ published: !published }),
    });
    setBusy(false);
    router.refresh();
  }

  if (certificateCount === 0) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">เผยแพร่ให้ค้นหาได้</h2>
      <p className="mt-1 text-sm text-gray-500">
        {published
          ? `เผยแพร่อยู่ — ผู้ปกครองค้นเจอเกียรติบัตร ${certificateCount} ใบนี้แล้ว`
          : `ยังไม่เผยแพร่ — เกียรติบัตร ${certificateCount} ใบนี้ยังไม่ปรากฏในหน้าค้นหา`}
      </p>
      {!published && unresolved > 0 && (
        <p className="mt-2 text-sm text-amber-700">
          ยังมี {unresolved} หน้าที่จับคู่ไม่ได้ เผยแพร่ได้แต่หน้าเหล่านั้นจะยังค้นไม่เจอ
        </p>
      )}
      <button
        onClick={toggle}
        disabled={busy}
        className={`mt-4 rounded-lg px-5 py-2.5 font-semibold text-white disabled:opacity-40 ${
          published ? "bg-gray-600" : "bg-green-700"
        }`}
      >
        {busy ? "กำลังบันทึก..." : published ? "ยกเลิกการเผยแพร่" : "เผยแพร่"}
      </button>
    </section>
  );
}
