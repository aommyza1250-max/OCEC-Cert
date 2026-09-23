"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MultiAwardPolicy, PublishSummary } from "@/lib/publish";
import { postJson } from "./client-api";

/**
 * เผยแพร่ / ยกเลิกการเผยแพร่
 *
 * เผยแพร่รายคน: คนที่ข้อมูลครบออกไป คนที่ยังมีปัญหาค้างไว้ — แสดงตัวเลขชัดก่อนกด
 * ระหว่างเผยแพร่อยู่ อัปโหลดหรือแก้อะไรไม่ได้เลย ต้องยกเลิกก่อน แก้ แล้วเผยแพร่ใหม่
 */
export function PublishPanel({
  batchId,
  published,
  legacy,
  processing,
  policy,
  needsDecision,
  summary,
  certificateCount,
  publishedCount,
}: {
  batchId: string;
  published: boolean;
  legacy: boolean;
  processing: boolean;
  policy: MultiAwardPolicy;
  needsDecision: boolean;
  summary: PublishSummary;
  certificateCount: number;
  publishedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: object, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/admin/batches/${batchId}/${path}`, body);
    setBusy(false);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  const blocked = needsDecision && policy === "UNDECIDED";

  return (
    <section className="space-y-4 rounded-2xl border border-hairline bg-card p-5">
      <div>
        <h2 className="font-semibold">เผยแพร่ให้ค้นหาได้</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {published
            ? `เผยแพร่อยู่ ${publishedCount} ใบ จากทั้งหมด ${certificateCount} ใบ — ต้องยกเลิกการเผยแพร่ก่อนจึงจะอัปโหลดหรือแก้ไขได้`
            : "เผยแพร่ทีละคน คนที่ข้อมูลครบออกไปก่อน คนที่ยังมีปัญหาค้างไว้จนกว่าจะแก้เสร็จแล้วกดเผยแพร่อีกครั้ง"}
        </p>
      </div>

      {legacy ? (
        <p className="rounded-lg border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          รอบนี้นำเข้าด้วยระบบเดิม ยังเผยแพร่อยู่ตามเดิม แต่เผยแพร่ใหม่ด้วยขั้นตอนใหม่ไม่ได้ —
          ถ้ายกเลิกการเผยแพร่ จะต้องลบรอบนี้แล้วนำเข้าใหม่ทั้งรอบ
        </p>
      ) : (
        !published && (
          <>
            <Preview summary={summary} />
            {needsDecision && (
              <PolicyChooser policy={policy} busy={busy} onPick={(p) => call("policy", { policy: p })} />
            )}
          </>
        )
      )}

      <div className="flex flex-wrap items-center gap-3">
        {published ? (
          <button
            type="button"
            onClick={() =>
              call(
                "publish",
                { published: false },
                legacy
                  ? "รอบนี้มาจากระบบเดิม ยกเลิกแล้วจะเผยแพร่กลับไม่ได้ ต้องนำเข้าใหม่ทั้งรอบ — ยืนยัน?"
                  : "ยกเลิกการเผยแพร่ทั้งรอบ? ผู้ปกครองจะค้นไม่เจอจนกว่าจะกดเผยแพร่อีกครั้ง",
              )
            }
            disabled={busy}
            className="min-h-11 cursor-pointer rounded-xl bg-ink-soft px-5 font-semibold text-white transition duration-200 disabled:opacity-40"
          >
            {busy ? "กำลังบันทึก..." : "ยกเลิกการเผยแพร่"}
          </button>
        ) : (
          !legacy && (
            <button
              type="button"
              onClick={() =>
                call(
                  "publish",
                  { published: true },
                  `เผยแพร่ ${summary.toPublish.certificates} ใบ ของผู้เข้าสอบ ${summary.toPublish.participants} คน?` +
                    (summary.held.participants ? ` (ค้างไว้ ${summary.held.participants} คน)` : ""),
                )
              }
              disabled={busy || blocked || processing || summary.toPublish.certificates === 0}
              className="min-h-11 cursor-pointer rounded-xl bg-ok-ink px-5 font-semibold text-white transition duration-200
                         hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "กำลังบันทึก..." : `เผยแพร่ ${summary.toPublish.certificates} ใบ`}
            </button>
          )
        )}
        {!published && processing && <span className="text-sm text-ink-soft">รอให้ระบบประมวลผลเสร็จก่อน</span>}
        {!published && blocked && <span className="text-sm text-warn-ink">ต้องเลือกตัวเลือกด้านบนก่อน</span>}
      </div>
      {error && <p className="text-sm text-danger-ink">{error}</p>}
    </section>
  );
}

function Preview({ summary }: { summary: PublishSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-ok-line bg-ok-bg p-4 text-sm text-ok-ink">
        <p className="font-medium">จะเผยแพร่</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.toPublish.certificates} ใบ</p>
        <p>
          ผู้เข้าสอบ {summary.toPublish.participants} คน (Online {summary.toPublish.byMode.ONLINE} · Onsite{" "}
          {summary.toPublish.byMode.ONSITE})
        </p>
        {summary.hiddenByPolicy > 0 && <p>ซ่อนใบรางวัลเสริมตามที่เลือกไว้ {summary.hiddenByPolicy} ใบ</p>}
      </div>
      <div className="rounded-lg border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
        <p className="font-medium">ค้างไว้ก่อน</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.held.participants} คน</p>
        {summary.held.byReason.length === 0 ? (
          <p>ไม่มี</p>
        ) : (
          <table className="mt-1 w-full">
            <tbody>
              {summary.held.byReason.map((r) => (
                <tr key={r.reason}>
                  <td className="py-0.5 pr-2">{r.label}</td>
                  <td className="py-0.5 text-right tabular-nums">Online {r.ONLINE}</td>
                  <td className="py-0.5 pl-3 text-right tabular-nums">Onsite {r.ONSITE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * ให้แอดมินบอกว่าฮ่องกงส่งเกียรติบัตรฉบับจริงมาแบบไหนในรอบนี้
 *
 * บางรอบส่งฉบับจริงของรางวัลเสริม (Perfect Score, รางวัลพิเศษ) มาด้วย บางรอบส่งแค่ใบรางวัลหลัก
 * ระบบเดาแทนไม่ได้ และถ้าเดาผิดผู้ปกครองจะโหลดใบที่ไม่มีฉบับจริงไป
 */
function PolicyChooser({
  policy,
  busy,
  onPick,
}: {
  policy: MultiAwardPolicy;
  busy: boolean;
  onPick: (policy: "ALL" | "MEDAL_ONLY") => void;
}) {
  const options = [
    { value: "ALL", label: "ทุกใบ", hint: "ผู้ปกครองเห็นทั้งใบรางวัลหลักและใบรางวัลเสริม" },
    { value: "MEDAL_ONLY", label: "เฉพาะใบรางวัลหลัก", hint: "ซ่อนใบรางวัลเสริมของคนที่มีใบรางวัลหลักด้วย" },
  ] as const;
  return (
    <div className="rounded-lg border border-brand-line bg-brand-soft p-4 text-sm">
      <p className="font-medium text-brand">ฮ่องกงส่งเกียรติบัตรฉบับจริงแบบไหนสำหรับรอบนี้</p>
      <p className="mt-1 text-ink-soft">รอบนี้มีผู้เข้าสอบที่ได้ทั้งรางวัลหลักและรางวัลเสริม (เช่น Perfect Score)</p>
      <div className="mt-3 flex flex-col gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 ${
              policy === o.value ? "border-brand" : "border-hairline"
            }`}
          >
            <input
              type="radio"
              className="mt-1"
              checked={policy === o.value}
              disabled={busy}
              onChange={() => onPick(o.value)}
            />
            <span>
              <b>{o.label}</b>
              <span className="block text-ink-soft">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
