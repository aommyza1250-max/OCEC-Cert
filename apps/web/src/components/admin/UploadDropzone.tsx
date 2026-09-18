"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Props = {
  batchId: string;
  kind: "zip" | "excel";
  accept: string;
  /** append = เติมไฟล์ที่ตกหล่น | replace = ตัดใหม่ทั้งรอบ (ลบผลเดิม) */
  mode?: "append" | "replace";
  label?: string;
  /** ข้อความยืนยันก่อนเริ่ม — ใส่เมื่อการกระทำนั้นลบของเดิมทิ้ง */
  confirmText?: string;
  danger?: boolean;
};

/**
 * อัปโหลดไฟล์ขึ้น R2 โดยตรงด้วย presigned URL
 *
 * ลำดับ: ขอลิงก์ -> PUT ไฟล์ขึ้น R2 -> แจ้งเซิร์ฟเวอร์ว่าเสร็จแล้วให้ตั้งงาน
 * ไฟล์ ZIP เกียรติบัตรมีขนาดหลายร้อย MB จึงต้องขึ้นตรง ไม่ผ่านเซิร์ฟเวอร์เว็บ
 * ใช้ XMLHttpRequest แทน fetch เพราะต้องการ progress ของการอัปโหลด ซึ่ง fetch ยังทำไม่ได้
 */
export function UploadDropzone({
  batchId,
  kind,
  accept,
  mode = "replace",
  label,
  confirmText,
  danger,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);

    try {
      const urlRes = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId, kind }),
      });
      if (!urlRes.ok) throw new Error((await urlRes.json()).error ?? "ขอลิงก์อัปโหลดไม่สำเร็จ");
      const { url, key, contentType } = await urlRes.json();

      await putWithProgress(url, file, contentType, setProgress);

      const attachRes = await fetch(`/api/admin/batches/${batchId}/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, key, mode }),
      });
      if (!attachRes.ok) throw new Error((await attachRes.json()).error ?? "เริ่มประมวลผลไม่สำเร็จ");

      setProgress(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
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
          if (file && (!confirmText || confirm(confirmText))) handleFile(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={`w-full rounded-lg border-2 border-dashed px-4 py-6 text-sm transition
                    disabled:opacity-50 ${
                      danger
                        ? "border-danger-line text-danger-ink hover:border-danger-ink"
                        : "border-hairline text-ink-soft hover:border-brand"
                    }`}
      >
        {uploading
          ? `กำลังอัปโหลด... ${progress}%`
          : (label ?? `เลือกไฟล์${kind === "zip" ? " ZIP เกียรติบัตร" : "รายชื่อ (.xlsx)"}`)}
      </button>

      {uploading && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger-ink">{error}</p>}
    </div>
  );
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // ต้องตรงกับ contentType ที่ใช้ตอน sign ไม่งั้น R2 จะปฏิเสธลายเซ็น
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`อัปโหลดไม่สำเร็จ (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("เชื่อมต่อที่เก็บไฟล์ไม่ได้"));
    xhr.send(file);
  });
}
