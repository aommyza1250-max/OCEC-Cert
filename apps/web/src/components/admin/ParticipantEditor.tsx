"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "./AddParticipantForm";
import { postJson } from "./client-api";

export type EditableEntry = {
  id: string;
  batchId: string;
  version: number;
  source: "EXCEL" | "MANUAL";
  candidateNo: string;
  nameEn: string | null;
  nameTh: string | null;
  examMode: "ONLINE" | "ONSITE";
  school: string | null;
  level: string | null;
};

/**
 * แก้ข้อมูลการสอบของผู้เข้าสอบ — เลข ชื่อ รูปแบบการสอบ โรงเรียน ระดับชั้น
 *
 * แก้แล้วระบบจับคู่ใหม่ทั้งรอบ ใบที่ไม่ตรงกับข้อมูลใหม่จะกลับไปให้ตรวจ ไม่ถูกเชื่อต่อเงียบ ๆ
 * ถ้าตัวคนนี้มีเกียรติบัตรรายการอื่นด้วย ระบบจะถามก่อนว่าจะแก้ชื่อทุกใบ หรือแยกเป็นคนใหม่
 */
export function ParticipantEditor({ entry, locked }: { entry: EditableEntry; locked: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    candidateNo: entry.candidateNo,
    nameEn: entry.nameEn ?? "",
    nameTh: entry.nameTh ?? "",
    examMode: entry.examMode,
    school: entry.school ?? "",
    level: entry.level ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<number | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(studentAction?: "RENAME_STUDENT" | "SEPARATE") {
    setBusy(true);
    setError(null);
    const result = await postJson(
      `/api/admin/participants/${entry.id}`,
      { version: entry.version, ...form, studentAction },
      "PATCH",
    );
    setBusy(false);
    if (!result.ok) {
      if (result.code === "STUDENT_HISTORY") return setHistory(Number(result.otherCertificates) || 0);
      return setError(result.error);
    }
    setHistory(null);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`ลบผู้เข้าสอบเลข ${entry.candidateNo} ออกจากรายชื่อ? หน้าที่ผูกกับคนนี้จะกลับไปรอจับคู่ใหม่`)) return;
    setBusy(true);
    const result = await postJson(`/api/admin/participants/${entry.id}`, { version: entry.version }, "DELETE");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.push(`/admin/batches/${entry.batchId}/participants`);
  }

  const changed =
    form.candidateNo !== entry.candidateNo ||
    form.nameEn !== (entry.nameEn ?? "") ||
    form.nameTh !== (entry.nameTh ?? "") ||
    form.examMode !== entry.examMode ||
    form.school !== (entry.school ?? "") ||
    form.level !== (entry.level ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-3 rounded-xl border border-hairline bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">ข้อมูลการสอบ</h2>
        <span className="text-sm text-ink-soft">
          {entry.source === "MANUAL"
            ? "เพิ่มเอง — อยู่ต่อหลังอัป Excel ชุดใหม่"
            : "มาจาก Excel — อัป Excel ชุดใหม่แล้วค่าในไฟล์จะมาแทนที่การแก้ตรงนี้"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="เลขผู้เข้าสอบ" value={form.candidateNo} onChange={set("candidateNo")} inputMode="numeric" />
        <fieldset className="text-sm">
          <legend className="mb-1 text-ink-soft">รูปแบบการสอบ</legend>
          <div className="flex gap-4">
            {(["ONLINE", "ONSITE"] as const).map((mode) => (
              <label key={mode} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={form.examMode === mode}
                  onChange={() => setForm((f) => ({ ...f, examMode: mode }))}
                />
                {mode === "ONLINE" ? "Online" : "Onsite"}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="ชื่อ-นามสกุล (อังกฤษ)" value={form.nameEn} onChange={set("nameEn")} />
        <Field label="ชื่อ-นามสกุล (ไทย)" value={form.nameTh} onChange={set("nameTh")} />
        <Field label="โรงเรียน" value={form.school} onChange={set("school")} />
        <Field label="ระดับชั้น" value={form.level} onChange={set("level")} />
      </div>

      {history !== null && (
        <div className="rounded-lg border border-warn-line bg-warn-bg p-3 text-sm text-warn-ink">
          <p>
            ผู้เข้าสอบคนนี้มีเกียรติบัตรรายการอื่นอีก <b>{history}</b> ใบ ถ้าแก้ชื่อที่ตัวคน ชื่อบนใบเหล่านั้น
            (ที่ผู้ปกครองค้นเจอ) จะเปลี่ยนตามทั้งหมด
          </p>
          <p className="mt-1">ถ้ารอบนี้ผูกผิดคนมาตั้งแต่แรก ให้เลือกแยกเป็นคนใหม่ ไม่ใช่แก้ชื่อคนเดิม</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save("RENAME_STUDENT")}
              className="min-h-10 cursor-pointer rounded-xl border border-warn-line bg-card px-3 transition duration-200"
            >
              คนเดียวกัน — แก้ชื่อทั้ง {history + 1} รายการ
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => save("SEPARATE")}
              className="min-h-10 cursor-pointer rounded-xl border border-warn-line bg-card px-3 transition duration-200"
            >
              คนละคน — แยกเป็นคนใหม่
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger-ink">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !changed || Boolean(locked)}
          className="min-h-11 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white transition duration-200
                     hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "กำลังบันทึก..." : locked ?? "บันทึกและจับคู่ใหม่"}
        </button>
        {entry.source === "MANUAL" && (
          <button
            type="button"
            onClick={remove}
            disabled={busy || Boolean(locked)}
            className="min-h-10 cursor-pointer rounded-xl border border-danger-line bg-card px-3 text-sm text-danger-ink
                       transition duration-200 hover:bg-danger-bg disabled:opacity-40"
          >
            ลบผู้เข้าสอบที่เพิ่มเอง
          </button>
        )}
      </div>
    </form>
  );
}
