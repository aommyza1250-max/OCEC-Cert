"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./client-api";

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
  version,
  linked,
  otherCertificates,
  candidates,
  locked,
}: {
  entryId: string;
  version: number;
  linked: { id: string; name: string; school: string | null } | null;
  otherCertificates: number;
  candidates: StudentCandidate[];
  locked: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: object, confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/admin/participants/${entryId}/${path}`, { version, ...body });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  const disabled = busy || Boolean(locked);

  return (
    <section className="space-y-3 rounded-xl border border-hairline bg-card p-4 text-sm">
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
      {error && <p className="text-danger-ink">{error}</p>}
    </section>
  );
}
