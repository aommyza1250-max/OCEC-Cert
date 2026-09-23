"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { postJson, uploadFile } from "./client-api";

type Props = {
  batchId: string;
  kind: "zip" | "roster";
  accept: string;
  label: string;
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
export function UploadDropzone({ batchId, kind, accept, label, disabled, disabledReason }: Props) {
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
        className="w-full cursor-pointer rounded-lg border-2 border-dashed border-hairline px-4 py-6 text-sm
                   text-ink-soft transition duration-200 hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? `กำลังอัปโหลด... ${progress}%` : disabled && disabledReason ? disabledReason : label}
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
