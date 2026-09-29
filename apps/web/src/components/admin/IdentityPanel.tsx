"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useId, useRef, useState } from "react";
import { postJson } from "./client-api";
import { useConfirmDialog } from "./ConfirmDialog";

export type StudentCandidate = {
  id: string;
  name: string;
  school: string | null;
  certificates: string[];
};

/**
 * ตัวคนของผู้เข้าสอบ — คนเดียวกันข้ามปีมีเกียรติบัตรรวมอยู่ที่เดียวบนหน้าค้นหา
 *
 * ระบบผูกเองเมื่อแน่ใจเท่านั้น ถ้าชื่อพ้องแยกไม่ออก ต้องให้แอดมินเลือก
 * (การสร้างคนใหม่ก็เป็นการเดาอย่างหนึ่ง ระบบจึงไม่ทำเอง)
 */
export function IdentityPanel({
  entryId,
  overviewHref,
  candidateNo,
  version,
  linked,
  otherCertificates,
  candidates,
  locked,
}: {
  entryId: string;
  overviewHref: string;
  candidateNo: string;
  version: number;
  linked: { id: string; name: string; school: string | null } | null;
  otherCertificates: number;
  candidates: StudentCandidate[];
  locked: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [typedNo, setTypedNo] = useState("");
  const pickerRef = useRef<HTMLDialogElement>(null);
  const pickerTitleId = useId();
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (choosing && !picker.open) picker.showModal();
    if (!choosing && picker.open) picker.close();
  }, [choosing]);

  async function call(path: string, body: object, confirmText: string) {
    if (!(await confirm(confirmText))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await postJson(`/api/admin/participants/${entryId}/${path}`, { version, ...body });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function relink() {
    const target = candidates.find((c) => c.id === selectedId);
    if (!target || typedNo.trim() !== candidateNo || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await postJson<{ oldStudentDeleted: boolean; cleanupBlocked: boolean }>(
      `/api/admin/participants/${entryId}/identity`,
      { action: "LINK", studentId: target.id, version },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChoosing(false);
    setNotice(result.cleanupBlocked
      ? "เปลี่ยนตัวคนแล้ว แต่ระเบียนเดิมยังถูกข้อมูลอื่นใช้อยู่ จึงไม่ได้ลบ"
      : result.oldStudentDeleted
        ? "เปลี่ยนตัวคนแล้ว และลบระเบียนที่สร้างพลาดซึ่งไม่มีข้อมูลอื่นใช้อยู่"
        : "เปลี่ยนตัวคนแล้ว ใบของรอบอื่นไม่เปลี่ยน");
    router.refresh();
  }

  const disabled = busy || Boolean(locked);

  return (
    <section className="space-y-3 rounded-xl border border-hairline bg-card p-4 text-sm">
      {dialog}
      <dialog
        ref={pickerRef}
        aria-labelledby={pickerTitleId}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setChoosing(false);
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-hairline bg-card p-0 text-ink shadow-2xl backdrop:bg-black/50"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <h3 id={pickerTitleId} className="text-lg font-semibold">เปลี่ยนตัวคนที่ผูก</h3>
          <p className="leading-6 text-ink-soft">
            เลือกคนที่ถูกต้องเพื่อย้ายเฉพาะเกียรติบัตรของผู้เข้าสอบเลข {candidateNo} ไปผูกด้วย
            ใบของรอบอื่นจะไม่ถูกเปลี่ยน และระเบียนที่สร้างพลาดจะถูกลบเมื่อไม่มีใครใช้อยู่
          </p>
          {candidates.length ? (
            <fieldset className="space-y-2" disabled={busy}>
              <legend className="mb-2 font-medium">เลือกตัวคนที่ถูกต้อง</legend>
              {candidates.map((candidate) => (
                <label key={candidate.id} className="flex min-h-11 cursor-pointer gap-3 rounded-xl border border-hairline p-3 transition duration-200 hover:bg-paper focus-within:outline-2 focus-within:outline-brand">
                  <input
                    type="radio"
                    name="relink-student"
                    value={candidate.id}
                    checked={selectedId === candidate.id}
                    onChange={() => setSelectedId(candidate.id)}
                    className="mt-1 accent-brand"
                  />
                  <span>
                    <span className="font-semibold">{candidate.name}</span>
                    {candidate.school && <span className="text-ink-soft"> · {candidate.school}</span>}
                    <span className="block text-ink-soft">
                      {candidate.certificates.length ? candidate.certificates.join(" · ") : "ยังไม่มีเกียรติบัตร"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="rounded-xl border border-warn-line bg-warn-bg p-3 text-warn-ink">
              ไม่พบตัวคนอื่นที่ชื่อเดียวกัน กรุณาตรวจชื่อในรายชื่อก่อน
            </p>
          )}
          <label className="block font-medium" htmlFor={`${pickerTitleId}-candidate`}>
            พิมพ์เลขผู้เข้าสอบ {candidateNo} เพื่อยืนยัน
          </label>
          <input
            id={`${pickerTitleId}-candidate`}
            value={typedNo}
            onChange={(event) => setTypedNo(event.target.value)}
            disabled={disabled || candidates.length === 0}
            inputMode="numeric"
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-hairline bg-card px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
          />
          {error && <p role="alert" className="text-danger-ink">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setChoosing(false)}
              className="min-h-11 cursor-pointer rounded-xl border border-hairline px-4 transition duration-200 hover:bg-paper focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={disabled || !selectedId || typedNo.trim() !== candidateNo}
              onClick={() => void relink()}
              className="min-h-11 cursor-pointer rounded-xl bg-brand px-4 font-semibold text-white transition duration-200 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
            >
              {busy ? "กำลังเปลี่ยน..." : "ยืนยันการเปลี่ยนตัวคน"}
            </button>
          </div>
        </div>
      </dialog>
      <h2 className="font-semibold">ตัวคน (ที่ผู้ปกครองค้นเจอ)</h2>
      {linked ? (
        <>
          <p>
            ผูกกับ <b>{linked.name}</b>
            {linked.school && <span className="text-ink-soft"> · {linked.school}</span>}
            {otherCertificates > 0 && (
              <span className="text-ink-soft"> · มีเกียรติบัตรรายการอื่นอีก {otherCertificates} ใบ</span>
            )}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setSelectedId("");
              setTypedNo("");
              setError(null);
              setChoosing(true);
            }}
            className="min-h-11 cursor-pointer rounded-xl border border-brand-line bg-card px-3 font-medium text-brand transition duration-200 hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
          >
            เปลี่ยนตัวคนที่ผูก
          </button>
          <Link
            href={overviewHref}
            className="inline-flex min-h-11 items-center rounded-xl border border-brand-line bg-card px-3 font-medium text-brand transition duration-200 hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            กลับภาพรวมรอบนี้ →
          </Link>
          {otherCertificates > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                call("separate", {}, "แยกผู้เข้าสอบคนนี้ออกเป็นคนใหม่? ใบของรายการอื่นจะอยู่กับคนเดิมตามเดิม")
              }
              className="min-h-10 cursor-pointer rounded-xl border border-hairline px-3 transition duration-200 hover:bg-paper disabled:opacity-40"
            >
              ผูกผิดคน — แยกเป็นคนใหม่
            </button>
          )}
        </>
      ) : candidates.length > 0 ? (
        <>
          <p className="text-warn-ink">
            มีผู้เข้าสอบชื่อนี้อยู่ในระบบแล้ว และระบบแยกไม่ออกว่าเป็นคนไหน — เลือกคนเดิม หรือสร้างเป็นคนใหม่
          </p>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline p-2">
                <span>
                  <b>{c.name}</b>
                  {c.school && <span className="text-ink-soft"> · {c.school}</span>}
                  <span className="block text-ink-soft">
                    {c.certificates.length > 0 ? c.certificates.join(", ") : "ยังไม่มีเกียรติบัตร"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => call("identity", { action: "LINK", studentId: c.id }, `ผูกกับ ${c.name} คนนี้?`)}
                  className="min-h-10 cursor-pointer rounded-xl border border-hairline px-3 transition duration-200 hover:bg-paper disabled:opacity-40"
                >
                  เป็นคนนี้
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("identity", { action: "NEW" }, "สร้างเป็นคนใหม่ที่บังเอิญชื่อเหมือนกัน?")}
            className="min-h-10 cursor-pointer rounded-xl border border-hairline px-3 transition duration-200 hover:bg-paper disabled:opacity-40"
          >
            คนใหม่ ไม่ใช่คนใดข้างบน
          </button>
        </>
      ) : (
        <p className="text-ink-soft">ยังไม่ได้ผูก — ระบบจะผูกให้เองเมื่อมีเกียรติบัตรที่จับคู่ผ่านแล้ว</p>
      )}
      {notice && <p role="status" className="text-ok-ink">{notice}</p>}
      {error && <p className="text-danger-ink">{error}</p>}
    </section>
  );
}
