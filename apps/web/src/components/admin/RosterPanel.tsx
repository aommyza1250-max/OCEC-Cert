"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { BatchView, RosterConflict, RosterDraft } from "@/lib/batch-view";
import { postJson } from "./client-api";
import { useConfirmDialog, type ConfirmAction } from "./ConfirmDialog";
import { UploadDropzone } from "./UploadDropzone";

type Totals = { total: number; online: number; onsite: number; excel: number; manual: number };

/**
 * ขั้นที่ 1: รายชื่อผู้เข้าสอบ (online + onsite ในไฟล์เดียว)
 *
 * รายชื่อคือแหล่งความจริงว่าใครควรได้เกียรติบัตร จึงต้องมาก่อนอัป ZIP เสมอ
 * ไฟล์ที่อัปเป็นแค่ "ร่าง" จนกว่าแอดมินจะเห็นยอดรวมแล้วกดใช้ — ร่างที่ผิดไม่แตะรายชื่อที่ใช้อยู่เลย
 */
export function RosterPanel({
  batchId,
  hasRoster,
  activeRoster,
  totals,
  draft,
  locked,
  footer,
}: {
  batchId: string;
  hasRoster: boolean;
  activeRoster: NonNullable<BatchView>["roster"]["active"];
  totals: Totals;
  draft: RosterDraft | null;
  /** ข้อความเมื่อแก้ไม่ได้ (เผยแพร่อยู่ / ระบบเดิม) — null = แก้ได้ */
  locked: string | null;
  footer?: React.ReactNode;
}) {
  const { confirm, dialog } = useConfirmDialog();

  return (
    <section className="rounded-[18px] border border-hairline bg-card p-5 shadow-sm sm:p-6">
      {dialog}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">ขั้นที่ 1 · อัปโหลดไฟล์รายชื่อ</h2>
          <p className="mt-1 text-sm text-ink-soft">รอระบบตรวจไฟล์และสรุปยอด ก่อนกดใช้รายชื่อชุดนี้</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${hasRoster ? "border-hairline bg-paper text-ink-soft" : "border-brand-line bg-brand-soft text-brand"}`}>
          {hasRoster ? "ใช้รายชื่อแล้ว" : draft?.status === "READY" ? "รอกดใช้รายชื่อ" : draft?.status === "INVALID" ? "ไฟล์ใช้ไม่ได้" : draft ? "กำลังตรวจรายชื่อ" : "รอไฟล์รายชื่อ"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <UploadDropzone
          batchId={batchId}
          kind="roster"
          accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx"
          label={hasRoster ? "เปลี่ยนไฟล์รายชื่อ" : "เลือกไฟล์รายชื่อ"}
          helperText="รองรับ .xlsx · ต้องมี Candidate No, Candidate Name และ Exam Mode"
          disabled={Boolean(locked)}
          disabledReason={locked ?? undefined}
        />
        <div className="min-w-0 rounded-2xl border border-hairline p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="min-w-0 break-all text-sm">{activeRoster?.fileName ?? "ยังไม่มีรายชื่อที่ใช้งาน"}</strong>
            <span className="rounded-full border border-hairline bg-paper px-2.5 py-1 text-xs text-ink-soft">
              {hasRoster ? "ใช้แล้ว" : "รอใช้"}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-soft">ผลตรวจรายชื่อชุดปัจจุบัน</p>
          {hasRoster ? (
            <RosterTotals totals={totals} conflicts={draft?.conflicts.length ?? 0} />
          ) : (
            <p className="mt-4 rounded-xl bg-paper px-4 py-5 text-sm text-ink-soft">ยอดทั้งหมด Online และ Onsite จะแสดงที่นี่หลังตรวจและใช้รายชื่อ</p>
          )}
        </div>
      </div>

      {draft && <DraftCard batchId={batchId} draft={draft} locked={locked} confirm={confirm} />}
      <p className="mt-4 text-sm text-ink-soft">
        เลขผู้เข้าสอบห้ามซ้ำกันทั้งไฟล์ · มี GRADE, AWARD, SCHOOL เพิ่มได้
        {hasRoster && " · รายการที่เพิ่มเองจะอยู่ต่อหลังอัปชุดใหม่"}
      </p>
      {footer && <div className="mt-5 border-t border-hairline pt-5">{footer}</div>}
    </section>
  );
}

function RosterTotals({ totals, conflicts }: { totals: Totals; conflicts: number }) {
  const items = [
    { label: "ทั้งหมด", value: totals.total, primary: true },
    { label: "Online", value: totals.online },
    { label: "Onsite", value: totals.onsite },
  ];
  return (
    <dl className="mt-4 grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label} className={`rounded-xl p-3 ${item.primary ? "bg-brand-soft" : "bg-paper"}`}>
          <dt className="text-xs text-ink-soft">{item.label}</dt>
          <dd className={`mt-1 whitespace-nowrap text-lg font-semibold tabular-nums sm:text-2xl ${item.primary ? "text-brand" : "text-ink"}`}>
            {item.value.toLocaleString("en-US")} <small className="text-xs font-medium">คน</small>
          </dd>
        </div>
      ))}
      <p className="col-span-full text-xs text-ink-soft">จาก Excel {totals.excel.toLocaleString("en-US")} · เพิ่มเอง {totals.manual.toLocaleString("en-US")} คน</p>
      {conflicts > 0 && (
        <p className="col-span-full text-sm text-warn-ink">
          ร่างรายชื่อที่รอใช้มีรายการที่ชนกับผู้เข้าสอบที่เพิ่มเอง {conflicts} รายการ — ต้องตัดสินก่อนกดใช้
        </p>
      )}
    </dl>
  );
}

function DraftCard({
  batchId,
  draft,
  locked,
  confirm,
}: {
  batchId: string;
  draft: RosterDraft;
  locked: string | null;
  confirm: ConfirmAction;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Resolution>>({});

  const unresolved = draft.conflicts.filter((c) => !decisions[c.id]).length;

  async function call(path: "activate" | "discard", body: object) {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/admin/batches/${batchId}/roster/${path}`, body);
    if (!result.ok) setError(result.error);
    setBusy(false);
    router.refresh();
  }

  const title = draft.fileName ?? "ไฟล์รายชื่อ";
  if (draft.status === "PENDING" || draft.status === "ACTIVATING") {
    return (
      <p className="mt-4 rounded-lg border border-brand-line bg-brand-soft px-4 py-3 text-sm text-brand">
        {draft.status === "PENDING" ? `กำลังตรวจ ${title}...` : `กำลังเปลี่ยนไปใช้ ${title} และจับคู่ใหม่ทั้งรอบ...`}
      </p>
    );
  }

  if (draft.status === "INVALID") {
    return (
      <div className="mt-4 rounded-lg border border-danger-line bg-danger-bg p-4">
        <p className="font-medium text-danger-ink">{title} ใช้ไม่ได้ — ยังไม่ได้แตะรายชื่อที่ใช้อยู่</p>
        <p className="mt-1 text-sm text-danger-ink">แก้ไฟล์ตามรายการนี้ แล้วอัปใหม่ทั้งไฟล์</p>
        <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm text-danger-ink">
          {draft.errors.map((e, i) => (
            <li key={i}>
              {e.row ? `แถว ${e.row}` : "ทั้งไฟล์"}
              {e.column && ` · ${e.column}`} — {e.message}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => call("discard", { importId: draft.id })}
          disabled={busy}
          className="mt-3 min-h-10 cursor-pointer rounded-xl border border-danger-line bg-card px-3 text-sm
                     text-danger-ink transition duration-200 hover:bg-danger-bg disabled:opacity-50"
        >
          ซ่อนร่างนี้
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-warn-line bg-warn-bg p-4">
      <p className="font-medium text-warn-ink">ร่างรายชื่อพร้อมใช้: {title}</p>
      <p className="mt-1 text-sm text-warn-ink">
        ทั้งหมด <b>{draft.totalCount}</b> คน · Online <b>{draft.onlineCount}</b> · Onsite{" "}
        <b>{draft.onsiteCount}</b> — ตรวจยอดให้ตรงกับที่ต้นทางแจ้งก่อนกดใช้
      </p>

      {draft.conflicts.length > 0 && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-warn-ink">
            แถวต่อไปนี้ชนกับผู้เข้าสอบที่เพิ่มเอง — เลือกว่าจะรวมเป็นคนเดียวกัน หรือเก็บรายการที่เพิ่มเองไว้
          </p>
          {draft.conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              value={decisions[conflict.id]}
              onChange={(value) => setDecisions((d) => ({ ...d, [conflict.id]: value }))}
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || unresolved > 0 || Boolean(locked)}
          onClick={async () => {
            if (
              !(await confirm("ใช้รายชื่อชุดนี้แทนชุดเดิม? ระบบจะจับคู่เกียรติบัตรใหม่ทั้งรอบ", {
                title: "ยืนยันการใช้รายชื่อ",
                confirmLabel: "ใช้รายชื่อชุดนี้",
              }))
            ) return;
            call("activate", {
              importId: draft.id,
              resolutions: Object.entries(decisions).map(([conflictId, r]) => ({ conflictId, ...r })),
            });
          }}
          className="min-h-11 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white
                     transition duration-200 hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "กำลังบันทึก..." : "ใช้รายชื่อชุดนี้"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => call("discard", { importId: draft.id })}
          className="min-h-10 cursor-pointer rounded-xl border border-hairline bg-card px-3 text-sm
                     transition duration-200 hover:bg-paper disabled:opacity-50"
        >
          ทิ้งร่างนี้
        </button>
        {unresolved > 0 && <span className="text-sm text-warn-ink">ยังไม่ได้ตัดสิน {unresolved} รายการ</span>}
      </div>
      {error && <p className="mt-2 text-sm text-danger-ink">{error}</p>}
    </div>
  );
}

type Resolution = {
  action: "MERGE" | "KEEP_MANUAL";
  fields?: Partial<Record<"candidateNo" | "name" | "examMode" | "school" | "level", "MANUAL" | "INCOMING">>;
};

const FIELDS = [
  { key: "candidateNo", label: "เลขผู้เข้าสอบ", read: (v: Record<string, unknown>) => v.candidateNo },
  { key: "name", label: "ชื่อ", read: (v: Record<string, unknown>) => v.nameEn ?? v.nameTh },
  { key: "examMode", label: "รูปแบบการสอบ", read: (v: Record<string, unknown>) => v.examMode },
  { key: "school", label: "โรงเรียน", read: (v: Record<string, unknown>) => v.school },
  { key: "level", label: "ระดับชั้น", read: (v: Record<string, unknown>) => v.level },
] as const;

/** รายการที่ชนกับผู้เข้าสอบที่เพิ่มเอง — ระบบไม่ตัดสินเอง เพราะทั้งรวมและแยกเดาผิดได้ */
function ConflictCard({
  conflict,
  value,
  onChange,
}: {
  conflict: RosterConflict;
  value: Resolution | undefined;
  onChange: (value: Resolution) => void;
}) {
  const differing = useMemo(
    () => FIELDS.filter((f) => String(f.read(conflict.manual) ?? "") !== String(f.read(conflict.incoming) ?? "")),
    [conflict],
  );

  return (
    <div className="rounded-lg border border-warn-line bg-card p-3 text-sm">
      <p className="font-medium">
        {conflict.reason === "SAME_NUMBER"
          ? `เลข ${conflict.incomingCandidateNo} มีอยู่แล้วในรายการที่เพิ่มเอง`
          : `ชื่อเดียวกับผู้เข้าสอบที่เพิ่มเอง (เลข ${conflict.manual.candidateNo}) แต่คนละเลข`}
        <span className="text-ink-soft"> · แถว {String(conflict.incoming.row)} ใน Excel</span>
      </p>
      <table className="mt-2 w-full text-left">
        <thead className="text-ink-soft">
          <tr>
            <th className="py-1 font-normal"></th>
            <th className="py-1 font-normal">ที่เพิ่มเอง</th>
            <th className="py-1 font-normal">ใน Excel</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key} className="border-t border-hairline">
              <td className="py-1 text-ink-soft">{f.label}</td>
              <td className="py-1">{String(f.read(conflict.manual) ?? "—")}</td>
              <td className="py-1">{String(f.read(conflict.incoming) ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-2">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            className="mt-1"
            checked={value?.action === "MERGE"}
            onChange={() => onChange({ action: "MERGE", fields: {} })}
          />
          <span>
            <b>คนเดียวกัน — รวมเป็นรายการเดียว</b>
            <span className="block text-ink-soft">หลังรวมจะถือเป็นรายการจาก Excel (อัป Excel ชุดหน้าจะแทนที่ได้)</span>
          </span>
        </label>
        {value?.action === "MERGE" && differing.length > 0 && (
          <div className="ml-6 space-y-1">
            {differing.map((f) => (
              <label key={f.key} className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-ink-soft">{f.label}</span>
                <select
                  value={value.fields?.[f.key] ?? "INCOMING"}
                  onChange={(e) =>
                    onChange({ action: "MERGE", fields: { ...value.fields, [f.key]: e.target.value as "MANUAL" } })
                  }
                  className="rounded-lg border border-hairline px-2 py-1"
                >
                  <option value="INCOMING">ใช้ค่าใน Excel: {String(f.read(conflict.incoming) ?? "—")}</option>
                  <option value="MANUAL">ใช้ค่าที่เพิ่มเอง: {String(f.read(conflict.manual) ?? "—")}</option>
                </select>
              </label>
            ))}
          </div>
        )}
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            className="mt-1"
            checked={value?.action === "KEEP_MANUAL"}
            onChange={() => onChange({ action: "KEEP_MANUAL" })}
          />
          <span>
            <b>เก็บรายการที่เพิ่มเองไว้ ไม่ใช้แถวนี้ใน Excel</b>
          </span>
        </label>
      </div>
    </div>
  );
}
