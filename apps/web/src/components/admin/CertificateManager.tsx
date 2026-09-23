"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { AwardDef } from "@/lib/certificate-catalog";
import { postJson, uploadFile, waitForJob } from "./client-api";
import { Preview, Secondary } from "./IssueList";
import { ModeBadge, PageStatusBadge } from "./StatusBadge";

export type ParticipantPage = {
  id: string;
  version: number;
  pageNumber: number;
  status: string;
  award: string;
  awardLabel: string;
  folderAward: string | null;
  overridden: boolean;
  zipMode: "ONLINE" | "ONSITE" | null;
  previewUrl: string | null;
  source: string;
  note: string | null;
  hasCertificate: boolean;
};

/**
 * เกียรติบัตรของผู้เข้าสอบคนนี้ — แยกจากข้อมูลการสอบชัดเจน
 *
 * เปลี่ยนไฟล์: ไฟล์ใหม่ต้องผ่านการตรวจเลขและชื่อก่อน จึงจะมาแทนใบเดิม (ใบเดิมเก็บไว้เป็นหลักฐาน)
 * เปลี่ยนรางวัล: เลือกได้เฉพาะรางวัลของรายการ/รอบนี้ และต้องยืนยัน รางวัลตามโฟลเดอร์ยังเก็บไว้เสมอ
 */
export function CertificateManager({
  batchId,
  entryId,
  pages,
  catalog,
  locked,
}: {
  batchId: string;
  entryId: string;
  pages: ParticipantPage[];
  catalog: AwardDef[];
  locked: string | null;
}) {
  const certificates = pages.filter((p) => p.hasCertificate);
  const others = pages.filter((p) => !p.hasCertificate);
  const taken = new Set(certificates.map((p) => p.award));

  return (
    <section className="space-y-3 rounded-xl border border-hairline bg-card p-4 text-sm">
      <h2 className="font-semibold">เกียรติบัตร ({certificates.length} ใบ)</h2>
      {certificates.length === 0 && <p className="text-warn-ink">ยังไม่มีเกียรติบัตรที่ผ่านการตรวจ</p>}
      <ul className="space-y-3">
        {certificates.map((page) => (
          <PageCard key={page.id} batchId={batchId} entryId={entryId} page={page} catalog={catalog} taken={taken} locked={locked} />
        ))}
      </ul>

      <AddCertificate batchId={batchId} entryId={entryId} catalog={catalog.filter((a) => !taken.has(a.code))} locked={locked} />

      {others.length > 0 && (
        <details className="rounded-lg bg-paper p-3">
          <summary className="cursor-pointer font-medium">หน้าอื่นของคนนี้ ({others.length}) — ติดปัญหา ถูกทิ้ง หรือถูกแทนแล้ว</summary>
          <ul className="mt-3 space-y-3">
            {others.map((page) => (
              <PageCard key={page.id} batchId={batchId} entryId={entryId} page={page} catalog={catalog} taken={taken} locked={locked} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PageCard({
  batchId,
  entryId,
  page,
  catalog,
  taken,
  locked,
}: {
  batchId: string;
  entryId: string;
  page: ParticipantPage;
  catalog: AwardDef[];
  taken: Set<string>;
  locked: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [award, setAward] = useState("");

  async function resolve(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/admin/pages/${page.id}/resolve`, { version: page.version, ...body });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  const disabled = busy || Boolean(locked);
  const targets = catalog.filter((a) => a.code !== page.award && !taken.has(a.code));

  return (
    <li className="rounded-lg border border-hairline p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Preview url={page.previewUrl} label={`หน้า ${page.pageNumber}`} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <PageStatusBadge status={page.status} />
            <ModeBadge mode={page.zipMode} />
            <b>{page.awardLabel}</b>
            {page.overridden && (
              <span className="text-ink-soft">(แอดมินเปลี่ยนจากโฟลเดอร์ {page.folderAward})</span>
            )}
          </div>
          <p className="text-ink-soft">มาจาก {page.source}</p>
          {page.note && <p className="text-warn-ink">{page.note}</p>}

          <div className="flex flex-wrap gap-2">
            {page.hasCertificate && (
              <ReplaceFile batchId={batchId} entryId={entryId} page={page} disabled={disabled} onError={setError} />
            )}
            {page.hasCertificate && targets.length > 0 && (
              <span className="flex items-center gap-2">
                <select
                  value={award}
                  onChange={(e) => setAward(e.target.value)}
                  className="rounded-lg border border-hairline px-2 py-2"
                  aria-label="เปลี่ยนรางวัลเป็น"
                >
                  <option value="">เปลี่ยนรางวัลเป็น...</option>
                  {targets.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <Secondary
                  disabled={disabled || !award}
                  onClick={() =>
                    resolve(
                      { action: "RECLASSIFY", awardCode: award, confirm: true },
                      `เปลี่ยนรางวัลของใบนี้จาก ${page.awardLabel} เป็น ${targets.find((a) => a.code === award)?.label}?`,
                    )
                  }
                >
                  เปลี่ยนรางวัล
                </Secondary>
              </span>
            )}
            {page.status === "DISCARDED" ? (
              <Secondary disabled={disabled} onClick={() => resolve({ action: "RESTORE" })}>
                คืนหน้านี้
              </Secondary>
            ) : (
              page.status !== "SUPERSEDED" && (
                <Secondary
                  disabled={disabled}
                  onClick={() => resolve({ action: "DISCARD" }, `ทิ้ง${page.hasCertificate ? "เกียรติบัตร" : "หน้า"}นี้?`)}
                >
                  ทิ้ง
                </Secondary>
              )
            )}
          </div>
          {error && <p className="text-danger-ink">{error}</p>}
        </div>
      </div>
    </li>
  );
}

/** เปลี่ยนไฟล์ของใบเดิม — ไฟล์ใหม่ต้องเป็นของคนนี้ (เลขและชื่อตรง) ถึงจะมาแทนได้ */
function ReplaceFile({
  batchId,
  entryId,
  page,
  disabled,
  onError,
}: {
  batchId: string;
  entryId: string;
  page: ParticipantPage;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<string | null>(null);

  async function handle(file: File) {
    onError(null);
    try {
      setState("กำลังอัปโหลด...");
      const key = await uploadFile(batchId, "pdf", file, (p) => setState(`กำลังอัปโหลด... ${p}%`));
      setState("กำลังตรวจไฟล์...");
      const result = await postJson<{ jobId: string }>(`/api/admin/participants/${entryId}/certificates`, {
        key,
        fileName: file.name,
        awardCode: page.award,
        purpose: "replace",
        replacePageId: page.id,
      });
      if (!result.ok) throw new Error(result.error);
      const job = await waitForJob(result.jobId);
      if (job.error) throw new Error(job.error);
      router.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "เปลี่ยนไฟล์ไม่สำเร็จ");
    } finally {
      setState(null);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handle(file);
          e.target.value = "";
        }}
      />
      <Secondary disabled={disabled || state !== null} onClick={() => input.current?.click()}>
        {state ?? "เปลี่ยนไฟล์ PDF"}
      </Secondary>
    </>
  );
}

/** เพิ่มใบให้คนนี้ — รางวัลต้องเลือกเองเสมอ ระบบไม่เดาจากข้อความบนหน้าหรือจาก Excel */
function AddCertificate({
  batchId,
  entryId,
  catalog,
  locked,
}: {
  batchId: string;
  entryId: string;
  catalog: AwardDef[];
  locked: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [award, setAward] = useState("");
  const [state, setState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handle(file: File) {
    setError(null);
    setNote(null);
    try {
      const key = await uploadFile(batchId, "pdf", file, (p) => setState(`กำลังอัปโหลด... ${p}%`));
      setState("กำลังตรวจไฟล์...");
      const result = await postJson<{ jobId: string }>(`/api/admin/participants/${entryId}/certificates`, {
        key,
        fileName: file.name,
        awardCode: award,
        purpose: "add",
      });
      if (!result.ok) throw new Error(result.error);
      const job = await waitForJob(result.jobId);
      if (job.error) throw new Error(job.error);
      setNote(((job.progress?.singlePdf ?? {}) as { note?: string }).note ?? null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "เพิ่มเกียรติบัตรไม่สำเร็จ");
    } finally {
      setState(null);
    }
  }

  if (catalog.length === 0) return null;
  return (
    <div className="rounded-lg border border-dashed border-hairline p-3">
      <p className="mb-2 font-medium">เพิ่มเกียรติบัตรให้คนนี้</p>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handle(file);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={award}
          onChange={(e) => setAward(e.target.value)}
          className="rounded-lg border border-hairline px-2 py-2"
          aria-label="รางวัลของใบที่จะเพิ่ม"
        >
          <option value="">เลือกรางวัล...</option>
          {catalog.map((a) => (
            <option key={a.code} value={a.code}>
              {a.label}
            </option>
          ))}
        </select>
        <Secondary disabled={!award || state !== null || Boolean(locked)} onClick={() => input.current?.click()}>
          {state ?? "เลือกไฟล์ PDF"}
        </Secondary>
      </div>
      <p className="mt-1 text-ink-soft">ไฟล์รวมเล่มก็ได้ ระบบคัดเฉพาะหน้าของคนนี้ (เลขและชื่อต้องตรง)</p>
      {error && <p className="mt-1 text-danger-ink">{error}</p>}
      {note && <p className="mt-1 text-ok-ink">{note}</p>}
    </div>
  );
}
