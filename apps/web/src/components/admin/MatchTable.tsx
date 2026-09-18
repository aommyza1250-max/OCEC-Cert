"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Page = {
  id: string;
  pageNumber: number;
  extractedName: string | null;
  certNo: string | null;
  level: string | null;
  award: string | null;
  matchStatus: string;
  matchNote: string | null;
  previewUrl: string | null;
  rawTextExcerpt: string;
};

export function MatchTable({ pages }: { pages: Page[] }) {
  if (pages.length === 0) {
    return (
      <p className="rounded-xl border border-ok-line bg-ok-bg px-5 py-6 text-center text-ok-ink">
        ทุกหน้าจับคู่เรียบร้อยแล้ว
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {pages.map((page) => (
        <MatchRow key={page.id} page={page} />
      ))}
    </ul>
  );
}

function MatchRow({ page }: { page: Page }) {
  const router = useRouter();
  const [nameTh, setNameTh] = useState("");
  // เติมชื่อที่ระบบอ่านได้ไว้ให้ก่อน แอดมินมักแค่ต้องแก้เล็กน้อย
  const [nameEn, setNameEn] = useState(page.extractedName ?? "");
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/admin/pages/${page.id}/match`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nameTh, nameEn, school }),
    });

    if (res.ok) router.refresh();
    else {
      setError((await res.json().catch(() => ({}))).error ?? "จับคู่ไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl border border-hairline bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="sm:w-56 sm:shrink-0">
          {page.previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={page.previewUrl}
              alt={`หน้า ${page.pageNumber}`}
              loading="lazy"
              className="w-full rounded-lg border border-hairline"
            />
          ) : (
            <div className="flex aspect-[842/595] items-center justify-center rounded-lg bg-paper text-sm text-ink-soft">
              ไม่มีรูป
            </div>
          )}
          <p className="mt-2 text-center text-sm text-ink-soft">หน้า {page.pageNumber}</p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                page.matchStatus === "AMBIGUOUS"
                  ? "bg-warn-bg text-warn-ink"
                  : "bg-paper text-ink-soft"
              }`}
            >
              {page.matchStatus === "AMBIGUOUS" ? "ชื่อซ้ำ ต้องเลือกเอง" : "ยังไม่มีคู่"}
            </span>
            {page.extractedName && (
              <span className="text-sm text-ink-soft">
                ระบบอ่านชื่อได้ว่า: <b className="text-ink">{page.extractedName}</b>
              </span>
            )}
            {page.certNo && (
              <span className="text-sm text-ink-soft">
                เลขเกียรติบัตร: <b className="text-ink">{page.certNo}</b>
              </span>
            )}
            {page.level && <span className="text-sm text-ink-soft">{page.level}</span>}
            {page.award && (
              <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                {page.award}
              </span>
            )}
          </div>

          {page.matchNote && <p className="mb-3 text-sm text-warn-ink">{page.matchNote}</p>}

          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={nameTh}
                onChange={(e) => setNameTh(e.target.value)}
                placeholder="ชื่อ-นามสกุล (ไทย)"
                className="rounded-lg border border-hairline px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="ชื่อ-นามสกุล (อังกฤษ)"
                className="rounded-lg border border-hairline px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <input
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="โรงเรียน (ช่วยแยกคนชื่อพ้อง)"
                className="rounded-lg border border-hairline px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>

            {error && <p className="text-sm text-danger-ink">{error}</p>}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={busy || (!nameTh.trim() && !nameEn.trim())}
                className="min-h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white transition duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 bg-brand hover:bg-brand-dark"
              >
                {busy ? "กำลังบันทึก..." : "จับคู่หน้านี้"}
              </button>
              <details className="text-sm text-ink-soft">
                <summary className="cursor-pointer">ดูข้อความที่อ่านได้จากหน้านี้</summary>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-paper p-3 text-xs">
                  {page.rawTextExcerpt || "(ไม่มีข้อความ)"}
                </pre>
              </details>
            </div>
          </form>
        </div>
      </div>
    </li>
  );
}
