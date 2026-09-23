"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AwardDef } from "@/lib/certificate-catalog";
import type { IssuePage } from "@/lib/batch-view";
import { postJson } from "./client-api";
import { ModeBadge, PageStatusBadge, pageStatusLabel } from "./StatusBadge";

/**
 * หน้าที่ระบบไม่ยอมเดาให้ — แต่ละแบบมีทางแก้ของตัวเอง
 *
 * ทุกปุ่มบันทึกการตัดสินไว้บนหน้า (ตัวจับคู่รอบถัดไปรักษาไว้) และลงประวัติการแก้ไข
 * กดแล้วระบบจับคู่ใหม่ทั้งรอบให้เอง หน้าจอจะรีเฟรชเมื่อเสร็จ
 */
export function IssueList({
  batchId,
  issues,
  catalog,
  locked,
}: {
  batchId: string;
  issues: IssuePage[];
  catalog: AwardDef[];
  locked: string | null;
}) {
  if (issues.length === 0) {
    return (
      <p className="rounded-xl border border-ok-line bg-ok-bg px-5 py-4 text-sm text-ok-ink">
        ไม่มีหน้าที่ต้องตัดสิน
      </p>
    );
  }

  const groups = new Map<string, IssuePage[]>();
  for (const issue of issues) groups.set(issue.status, [...(groups.get(issue.status) ?? []), issue]);

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([status, pages]) => (
        <details key={status} open={pages.length <= 20} className="rounded-xl border border-warn-line bg-card">
          <summary className="cursor-pointer px-4 py-3 font-medium">
            {pageStatusLabel(status)} ({pages.length} หน้า)
            <span className="ml-2 text-sm font-normal text-ink-soft">{GROUP_HINT[status]}</span>
          </summary>
          <ul className="space-y-3 border-t border-hairline p-3">
            {pages.map((page) => (
              <IssueCard key={page.id} batchId={batchId} page={page} catalog={catalog} locked={locked} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

const GROUP_HINT: Record<string, string> = {
  NAME_MISMATCH: "เลขตรงกับรายชื่อ แต่ชื่อบนหน้าไม่ตรง",
  MODE_MISMATCH: "เลขและชื่อตรง แต่ไฟล์อยู่ผิดโฟลเดอร์ online/onsite",
  AMBIGUOUS: "ระบบระบุตัวไม่ได้ ต้องเลือกเอง",
  DUPLICATE_NAME: "คนนี้มีใบรางวัลเดียวกันที่รับไปแล้ว",
  NATIONALITY_UNVERIFIED: "รอบ Final แต่หน้านี้ไม่มีหลักฐานว่าเป็นคนไทย",
  PARSE_REVIEW: "รอบหรือปีบนหน้าไม่ตรงกับรอบนำเข้านี้",
  UNMATCHED: "ไม่มีผู้เข้าสอบในรายชื่อที่ตรงกับหน้านี้",
};

function IssueCard({
  batchId,
  page,
  catalog,
  locked,
}: {
  batchId: string;
  page: IssuePage;
  catalog: AwardDef[];
  locked: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <li className="rounded-lg border border-hairline p-3">
      <div className="flex flex-col gap-4 sm:flex-row">
        <Preview url={page.previewUrl} label={`หน้า ${page.pageNumber}`} />
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <PageStatusBadge status={page.status} />
            <ModeBadge mode={page.zipMode} />
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
              {page.awardLabel}
            </span>
          </div>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <Row label="ชื่อบนหน้า" value={page.extractedName ?? "อ่านไม่ได้"} />
            <Row label="เลขบนหน้า" value={page.certNo ?? "อ่านไม่ได้"} />
            {page.level && <Row label="ระดับชั้นบนหน้า" value={page.level} />}
            {page.schoolOnPage && <Row label="โรงเรียนบนหน้า" value={page.schoolOnPage} />}
            {page.countryOnPage && <Row label="ประเทศบนหน้า" value={page.countryOnPage} />}
            {page.entry && (
              <Row
                label="ในรายชื่อ"
                value={`${page.entry.candidateNo} · ${page.entry.name} · ${page.entry.examMode === "ONLINE" ? "Online" : "Onsite"}`}
              />
            )}
            <Row label="มาจาก" value={[page.uploadName, page.sourceFile].filter(Boolean).join(" › ") || "—"} />
          </dl>
          {page.note && <p className="text-warn-ink">{page.note}</p>}
          {[...page.parseErrors, ...page.warnings].map((w) => (
            <p key={w} className="text-ink-soft">
              · {w}
            </p>
          ))}

          <div className="flex flex-wrap gap-2 pt-1">
            <Actions page={page} batchId={batchId} catalog={catalog} disabled={disabled} resolve={resolve} />
          </div>
          {error && <p className="text-danger-ink">{error}</p>}
        </div>
      </div>
    </li>
  );
}

function Actions({
  page,
  batchId,
  catalog,
  disabled,
  resolve,
}: {
  page: IssuePage;
  batchId: string;
  catalog: AwardDef[];
  disabled: boolean;
  resolve: (body: Record<string, unknown>, confirmText?: string) => void;
}) {
  const discard = (
    <Secondary disabled={disabled} onClick={() => resolve({ action: "DISCARD" }, `ทิ้งหน้า ${page.pageNumber}?`)}>
      ทิ้งหน้านี้
    </Secondary>
  );

  switch (page.status) {
    case "NAME_MISMATCH":
      return (
        <>
          <Primary
            disabled={disabled || !page.entry}
            onClick={() =>
              resolve(
                { action: "LINK_ENTRY", entryId: page.entry?.id },
                `ยืนยันว่าหน้านี้เป็นของ ${page.entry?.name} (เลข ${page.entry?.candidateNo}) ทั้งที่ชื่อบนหน้าเขียนว่า ${page.extractedName}?`,
              )
            }
          >
            คนเดียวกัน — จับคู่ด้วยมือ
          </Primary>
          {page.entry && <EditLink batchId={batchId} entryId={page.entry.id} label="แก้ชื่อในรายชื่อ" />}
          {discard}
        </>
      );
    case "MODE_MISMATCH":
      return (
        <>
          <Primary
            disabled={disabled}
            onClick={() =>
              resolve(
                { action: "USE_ROSTER_MODE" },
                `ใช้รูปแบบการสอบตามรายชื่อ (${page.entry?.examMode === "ONLINE" ? "Online" : "Onsite"}) สำหรับหน้านี้?`,
              )
            }
          >
            ใช้รูปแบบตามรายชื่อ
          </Primary>
          <Secondary
            disabled={disabled}
            onClick={() => resolve({ action: "DISCARD" }, "ทิ้งหน้านี้แล้วรอไฟล์ที่จัดโฟลเดอร์ถูก?")}
          >
            ทิ้งและรอไฟล์ใหม่
          </Secondary>
          <p className="w-full text-ink-soft">
            หรืออัป ZIP ที่ย้ายไฟล์ไปโฟลเดอร์ที่ถูกแล้ว — หน้านี้จะถูกแทนเอง
          </p>
        </>
      );
    case "AMBIGUOUS":
      if (page.identityPending && page.entry) {
        return (
          <>
            <EditLink batchId={batchId} entryId={page.entry.id} label="เลือกว่าเป็นคนไหน" primary />
            {discard}
          </>
        );
      }
      return (
        <>
          {page.candidates.map((c) => (
            <Secondary
              key={c.id}
              disabled={disabled}
              onClick={() =>
                resolve({ action: "LINK_ENTRY", entryId: c.id }, `หน้านี้เป็นของ ${c.name} (เลข ${c.candidateNo})?`)
              }
            >
              เป็นของ {c.candidateNo} · {c.name}
              {c.school ? ` (${c.school})` : ""}
            </Secondary>
          ))}
          {discard}
        </>
      );
    case "DUPLICATE_NAME":
      return (
        <>
          {page.acceptedPage && (
            <div className="w-full">
              <p className="mb-1 text-ink-soft">ใบที่รับไปแล้ว (หน้า {page.acceptedPage.pageNumber})</p>
              <Preview url={page.acceptedPage.previewUrl} label={`หน้า ${page.acceptedPage.pageNumber}`} small />
            </div>
          )}
          {page.acceptedPage && (
            <Secondary
              disabled={disabled}
              onClick={() =>
                resolve({ action: "USE_THIS" }, `ใช้หน้า ${page.pageNumber} แทนใบเดิม (หน้า ${page.acceptedPage?.pageNumber})?`)
              }
            >
              ใช้หน้านี้แทนใบเดิม
            </Secondary>
          )}
          <Secondary disabled={disabled} onClick={() => resolve({ action: "DISCARD" }, "เป็นใบซ้ำ — ทิ้งหน้านี้?")}>
            ใบซ้ำ — ทิ้งหน้านี้
          </Secondary>
          <Reclassify page={page} catalog={catalog} disabled={disabled} resolve={resolve} />
        </>
      );
    case "NATIONALITY_UNVERIFIED":
      return (
        <>
          <Primary
            disabled={disabled}
            onClick={() => resolve({ action: "CONFIRM_NATIONALITY" }, "ยืนยันว่าหน้านี้เป็นของผู้เข้าสอบไทย?")}
          >
            เป็นผู้เข้าสอบไทย
          </Primary>
          <Secondary disabled={disabled} onClick={() => resolve({ action: "MARK_FOREIGN" })}>
            ต่างชาติ — ไม่นำเข้า
          </Secondary>
        </>
      );
    case "PARSE_REVIEW":
      return (
        <>
          <Secondary
            disabled={disabled}
            onClick={() => resolve({ action: "ACCEPT_PARSE" }, "หน้านี้เป็นของรอบนำเข้านี้จริง แม้รอบ/ปีบนหน้าไม่ตรง?")}
          >
            เป็นของรอบนี้จริง — รับไว้
          </Secondary>
          {discard}
        </>
      );
    default:
      return (
        <>
          <LinkByNumber page={page} disabled={disabled} resolve={resolve} />
          <Link
            href={`/admin/batches/${batchId}/participants?add=1&fromPage=${page.id}`}
            className="min-h-10 cursor-pointer rounded-xl border border-hairline px-3 py-2 transition duration-200 hover:bg-paper"
          >
            เพิ่มเป็นผู้เข้าสอบที่ตกหล่น
          </Link>
          {discard}
        </>
      );
  }
}

/** ผูกกับผู้เข้าสอบด้วยเลข — สำหรับหน้าที่อ่านเลขไม่ได้ (ถ้าอ่านเลขได้ ต้องเป็นเลขเดียวกันเท่านั้น) */
function LinkByNumber({
  page,
  disabled,
  resolve,
}: {
  page: IssuePage;
  disabled: boolean;
  resolve: (body: Record<string, unknown>, confirmText?: string) => void;
}) {
  const [number, setNumber] = useState("");
  if (page.certNo) return null;
  return (
    <span className="flex items-center gap-2">
      <input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="เลขผู้เข้าสอบ"
        className="w-36 rounded-lg border border-hairline px-3 py-2"
      />
      <Secondary
        disabled={disabled || !number.trim()}
        onClick={() =>
          resolve({ action: "LINK_ENTRY", candidateNo: number.trim() }, `หน้านี้เป็นของผู้เข้าสอบเลข ${number.trim()}?`)
        }
      >
        ผูกกับเลขนี้
      </Secondary>
    </span>
  );
}

function Reclassify({
  page,
  catalog,
  disabled,
  resolve,
}: {
  page: IssuePage;
  catalog: AwardDef[];
  disabled: boolean;
  resolve: (body: Record<string, unknown>, confirmText?: string) => void;
}) {
  const [award, setAward] = useState("");
  const options = catalog.filter((a) => a.code !== page.award);
  return (
    <span className="flex items-center gap-2">
      <select
        value={award}
        onChange={(e) => setAward(e.target.value)}
        className="rounded-lg border border-hairline px-2 py-2"
      >
        <option value="">เปลี่ยนรางวัลของหน้านี้เป็น...</option>
        {options.map((a) => (
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
            `เปลี่ยนรางวัลของหน้านี้จาก ${page.awardLabel} เป็น ${options.find((a) => a.code === award)?.label}? ` +
              "(รางวัลตามโฟลเดอร์ยังถูกเก็บไว้เป็นหลักฐาน)",
          )
        }
      >
        เปลี่ยนรางวัล
      </Secondary>
    </span>
  );
}

export function Preview({ url, label, small }: { url: string | null; label: string; small?: boolean }) {
  return (
    <div className={small ? "w-40" : "sm:w-56 sm:shrink-0"}>
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt={label} loading="lazy" className="w-full rounded-lg border border-hairline" />
      ) : (
        <div className="flex aspect-[842/595] items-center justify-center rounded-lg bg-paper text-sm text-ink-soft">
          ไม่มีรูป
        </div>
      )}
      {!small && <p className="mt-1 text-center text-sm text-ink-soft">{label}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-soft">{label}:</dt>
      <dd className="min-w-0 font-medium">{value}</dd>
    </div>
  );
}

function EditLink({
  batchId,
  entryId,
  label,
  primary,
}: {
  batchId: string;
  entryId: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={`/admin/batches/${batchId}/participants/${entryId}`}
      className={`min-h-10 cursor-pointer rounded-xl px-3 py-2 transition duration-200 ${
        primary ? "bg-brand font-semibold text-white hover:bg-brand-dark" : "border border-hairline hover:bg-paper"
      }`}
    >
      {label}
    </Link>
  );
}

export function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 cursor-pointer rounded-xl bg-brand px-4 font-semibold text-white transition duration-200
                 hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Secondary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-10 cursor-pointer rounded-xl border border-hairline bg-card px-3 transition duration-200
                 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
