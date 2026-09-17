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
  latestJob: {
    id: string;
    type: string;
    status: string;
    error: string | null;
    /** true = ไฟล์ที่อัปเข้ามาไม่ถูก ไม่ใช่ระบบพัง */
    userError: boolean;
  } | null;
  publishState: PublishState;
};

export type PublishState = {
  policy: "UNDECIDED" | "ALL" | "MEDAL_ONLY";
  /** ต้องให้แอดมินเลือกก่อนไหม — จริงเฉพาะเมื่อมีคนถือทั้งใบเหรียญและ Perfect Score */
  needsDecision: boolean;
  publishedCount: number;
  /** คนที่ถูกกันไว้เพราะข้อมูลยังไม่ครบ */
  held: { name: string; certNo: string | null; reason: string }[];
  /** คนที่ถือทั้งใบเหรียญและ Perfect Score ในรอบนี้ */
  multiAward: { name: string; awards: string[] }[];
  /** ข้อมูลครบแล้วแต่ยังไม่ถูกเผยแพร่ — เกิดหลังเติมไฟล์ที่ตกหล่น */
  readyToPublish: number;
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
        {props.hasZip ? <ZipActions batchId={props.batchId} /> : (
          <UploadDropzone batchId={props.batchId} kind="zip" accept="application/zip,.zip" />
        )}
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

      {/* ความผิดพลาดของไฟล์ที่อัปเข้ามาแสดงในช่องอัปโหลดของคนนั้นอยู่แล้ว
          ขึ้นซ้ำตรงนี้อีกมีแต่จะรก ที่นี่จึงเหลือไว้เฉพาะตอนระบบพังจริง */}
      {props.latestJob?.status === "FAILED" && !props.latestJob.userError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="font-medium text-red-800">ประมวลผลล้มเหลว</p>
          <p className="mt-1 text-sm text-red-700">{props.latestJob.error}</p>
          <p className="mt-2 text-sm text-red-600">
            ถ้าแก้เองไม่ได้ ให้ดู docs/runbook.md หรือส่งข้อความนี้ให้ผู้ดูแลระบบ
          </p>
        </div>
      )}

      <StatsPanel stats={props.stats} counts={props.counts} />

      <PublishPanel
        batchId={props.batchId}
        status={props.status}
        state={props.publishState}
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

/**
 * หลังนำเข้ารอบแรกแล้ว ปุ่มอัปโหลดต้องแยกให้ชัดว่าเป็นการ "เติม" หรือ "ตัดใหม่"
 *
 * เคสที่เกิดบ่อยคือต้นทางส่งเกียรติบัตรมาไม่ครบ แล้วส่งตามมาทีหลัง
 * ถ้าปุ่มเดียวแล้วตัดใหม่ทั้งรอบ ของที่นำเข้าไปแล้วจะหายหมดรวมถึงที่จับคู่ด้วยมือไว้
 */
function ZipActions({ batchId }: { batchId: string }) {
  const [showDanger, setShowDanger] = useState(false);

  return (
    <div className="space-y-3">
      <UploadDropzone
        batchId={batchId}
        kind="zip"
        accept="application/zip,.zip"
        mode="append"
        label="เลือกไฟล์ ZIP ที่มีเกียรติบัตรตกหล่น"
      />
      <p className="text-sm text-gray-500">
        หน้าที่นำเข้าไปแล้วจะไม่ถูกแตะ ระบบเติมเฉพาะใบที่ยังไม่มี
        (ดูจากเลขผู้เข้าสอบคู่กับรางวัล) จะอัป ZIP ชุดเต็มทั้งก้อนก็ได้ ไม่ต้องแยกไฟล์
        {" "}และถ้านำเข้ารายชื่อไว้แล้ว ระบบจะจับคู่ต่อให้อัตโนมัติ
      </p>

      {showDanger ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="mb-3 text-sm text-red-800">
            <b>ตัดใหม่ทั้งรอบ</b> จะลบหน้าที่นำเข้าไปแล้วทั้งหมดของรอบนี้ทิ้ง
            รวมถึงเกียรติบัตรที่ออกไปแล้วและที่จับคู่ด้วยมือไว้
            ใช้เฉพาะตอนไฟล์ชุดเดิมผิดทั้งชุดเท่านั้น
          </p>
          <UploadDropzone
            batchId={batchId}
            kind="zip"
            accept="application/zip,.zip"
            mode="replace"
            danger
            label="เลือกไฟล์ ZIP ชุดใหม่ (ลบของเดิมทิ้ง)"
            confirmText="ยืนยันลบหน้าที่นำเข้าไปแล้วทั้งหมดของรอบนี้ แล้วตัดใหม่จากไฟล์ที่เลือก?"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowDanger(true)}
          className="text-sm text-gray-400 underline hover:text-red-600"
        >
          ไฟล์ชุดเดิมผิดทั้งชุด ต้องการตัดใหม่ทั้งรอบ
        </button>
      )}
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
    { label: "ข้ามเพราะมีอยู่แล้ว", value: num(stats.pagesSkippedExisting) },
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
  state,
  certificateCount,
  unresolved,
}: {
  batchId: string;
  status: string;
  state: PublishState;
  certificateCount: number;
  unresolved: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = status === "PUBLISHED";

  async function call(path: string, body: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/batches/${batchId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "ทำรายการไม่สำเร็จ");
    setBusy(false);
    router.refresh();
  }

  if (certificateCount === 0) return null;

  const blocked = state.needsDecision && state.policy === "UNDECIDED";

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">เผยแพร่ให้ค้นหาได้</h2>
        <p className="mt-1 text-sm text-gray-500">
          เผยแพร่ทีละคน คนที่ข้อมูลครบออกไปก่อน ส่วนคนที่ยังไม่ครบค้างไว้จนกว่าจะได้ไฟล์
        </p>
      </div>

      {state.multiAward.length > 0 && (
        <PolicyChooser
          state={state}
          busy={busy}
          onPick={(policy) => call("policy", { policy })}
        />
      )}

      {state.held.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">
            ค้างไว้เพราะข้อมูลไม่ครบ {state.held.length} คน
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {state.held.map((h) => (
              <li key={h.name + h.certNo}>
                {h.name}
                {h.certNo && <span className="text-amber-700"> (เลข {h.certNo})</span>} — {h.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-amber-700">
            โยนไฟล์เข้าไปในบล็อกของคนนั้นได้ที่หัวข้อ &ldquo;รายการที่ต้องตามเก็บ&rdquo; ด้านล่าง
            เสร็จแล้วกดเผยแพร่อีกครั้ง คนที่พร้อมแล้วจะตามออกไปเอง
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-gray-600">
          {published
            ? `เผยแพร่อยู่ ${state.publishedCount} ใบ จากทั้งหมด ${certificateCount} ใบ`
            : `ยังไม่เผยแพร่ — เกียรติบัตร ${certificateCount} ใบยังไม่ปรากฏในหน้าค้นหา`}
        </p>

        {published && state.readyToPublish > 0 && (
          <button
            onClick={() => call("publish", { published: true })}
            disabled={busy}
            className="rounded-lg bg-green-700 px-5 py-2.5 font-semibold text-white disabled:opacity-40"
          >
            {busy ? "กำลังบันทึก..." : `เผยแพร่เพิ่ม ${state.readyToPublish} ใบ`}
          </button>
        )}

        <button
          onClick={() => call("publish", { published: !published })}
          disabled={busy || (!published && blocked)}
          className={`rounded-lg px-5 py-2.5 font-semibold text-white disabled:opacity-40 ${
            published ? "bg-gray-600" : "bg-green-700"
          }`}
        >
          {busy ? "กำลังบันทึก..." : published ? "ยกเลิกการเผยแพร่" : "เผยแพร่"}
        </button>
      </div>

      {!published && blocked && (
        <p className="text-sm text-amber-700">
          รอบนี้มีผู้เข้าสอบที่ถือทั้งใบเหรียญและใบ Perfect Score กรุณาเลือกด้านบนก่อน
        </p>
      )}
      {!published && unresolved > 0 && (
        <p className="text-sm text-amber-700">
          ยังมี {unresolved} หน้าที่จับคู่ไม่ได้ เผยแพร่ได้แต่หน้าเหล่านั้นจะยังค้นไม่เจอ
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

/**
 * ให้แอดมินบอกว่าฮ่องกงส่งเกียรติบัตรฉบับจริงมาแบบไหนในรอบนี้
 *
 * Perfect Score เป็นรางวัลเสริมที่ให้คนได้เหรียญทองซึ่งทำคะแนนได้ดี
 * บางรอบฮ่องกงส่งฉบับจริงมาทั้งสองใบ บางรอบส่งมาแค่ใบเหรียญ
 * ระบบเดาแทนไม่ได้ และถ้าเดาผิดผู้ปกครองจะโหลดใบที่ไม่มีฉบับจริงไป
 */
function PolicyChooser({
  state,
  busy,
  onPick,
}: {
  state: PublishState;
  busy: boolean;
  onPick: (policy: "ALL" | "MEDAL_ONLY") => void;
}) {
  const options = [
    { value: "ALL", label: "ทั้งสองใบ", hint: "ผู้ปกครองเห็นทั้งใบเหรียญและใบ Perfect Score" },
    {
      value: "MEDAL_ONLY",
      label: "เฉพาะใบเหรียญ",
      hint: `ผู้ปกครองเห็นแค่ใบเหรียญ — ซ่อนใบ Perfect Score ${state.multiAward.length} ใบ`,
    },
  ] as const;

  return (
    <div className="rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] p-4">
      <p className="font-medium text-[var(--color-brand)]">
        ฮ่องกงส่งเกียรติบัตรฉบับจริงแบบไหนสำหรับรอบนี้
      </p>
      <p className="mt-1 text-sm text-gray-600">
        มีผู้เข้าสอบ {state.multiAward.length} คนที่ถือทั้งใบเหรียญและใบ Perfect Score
      </p>

      <ul className="mt-2 text-sm text-gray-600">
        {state.multiAward.map((p) => (
          <li key={p.name}>
            {p.name} — {p.awards.join(" + ")}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-col gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border bg-white px-3 py-2 ${
              state.policy === o.value ? "border-[var(--color-brand)]" : "border-gray-200"
            }`}
          >
            <input
              type="radio"
              className="mt-1"
              checked={state.policy === o.value}
              disabled={busy}
              onChange={() => onPick(o.value)}
            />
            <span>
              <b>{o.label}</b>
              <span className="block text-sm text-gray-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
