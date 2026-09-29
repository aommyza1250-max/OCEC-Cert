"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { postJson, uploadFile } from "./client-api";

type Props = {
  batchId: string;
  kind: "zip" | "roster";
  accept: string;
  label: string;
  helperText?: string;
  variant?: "dropzone" | "button";
  disabled?: boolean;
  /** เหตุผลที่ปิดไว้ — แสดงแทนปุ่มให้รู้ว่าต้องทำอะไรก่อน */
  disabledReason?: string;
};

/**
 * อัปโหลดไฟล์ขึ้น R2 โดยตรงด้วย presigned URL แล้วแจ้งเซิร์ฟเวอร์ให้ตั้งงาน
 *
 * ลำดับ: ขอลิงก์ -> PUT ไฟล์ขึ้น R2 -> แจ้งเซิร์ฟเวอร์ว่าเสร็จแล้ว
 * ไฟล์ ZIP เกียรติบัตรมีขนาดหลายร้อย MB จึงต้องขึ้นตรง ไม่ผ่านเซิร์ฟเวอร์เว็บ
 */
export function UploadDropzone({ batchId, kind, accept, label, helperText, variant = "dropzone", disabled, disabledReason }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    try {
      const key = await uploadFile(batchId, kind, file, setProgress);
      const result = await postJson(`/api/admin/batches/${batchId}/attach`, { kind, key, fileName: file.name });
      if (!result.ok) throw new Error(result.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || disabled}
        className={variant === "button"
          ? "mt-3 min-h-11 cursor-pointer rounded-xl border border-brand-line bg-card px-4 text-sm font-semibold text-brand transition duration-200 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60"
          : "flex min-h-44 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-line bg-brand-soft/30 px-5 py-5 text-center text-sm transition duration-200 hover:border-brand hover:bg-brand-soft/60 disabled:cursor-not-allowed disabled:opacity-60"}
      >
        {variant === "button" ? (
          uploading ? `กำลังอัปโหลด... ${progress}%` : disabled && disabledReason ? disabledReason : label
        ) : (
          <>
            <span aria-hidden="true" className="mb-2 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
            </span>
            <span className="font-semibold text-ink">
              {uploading ? `กำลังอัปโหลด... ${progress}%` : disabled && disabledReason ? disabledReason : "เลือกไฟล์จากเครื่อง"}
            </span>
            {helperText && <span className="mt-1 text-xs text-ink-soft">{helperText}</span>}
            {!disabled && !uploading && (
              <span className="mt-3 rounded-xl border border-brand-line bg-card px-4 py-2 font-semibold text-brand">{label}</span>
            )}
          </>
        )}
      </button>
      {uploading && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
          <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger-ink">{error}</p>}
    </div>
  );
}
