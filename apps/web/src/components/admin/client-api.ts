/**
 * ตัวช่วยฝั่งเบราว์เซอร์ของหน้าแอดมิน — อัปไฟล์ขึ้น R2 ตรง ๆ เรียก API และรอผลงานเบื้องหลัง
 *
 * ไฟล์ใหญ่ขึ้น R2 ด้วย presigned URL เสมอ ไม่ผ่านเซิร์ฟเวอร์เว็บ
 * ใช้ XMLHttpRequest แทน fetch เพราะต้องการ progress ของการอัปโหลด ซึ่ง fetch ยังทำไม่ได้
 */

export type ApiResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string; [key: string]: unknown };

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "ทำรายการไม่สำเร็จ", ...data };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง" };
  }
}

/** ขอลิงก์ -> อัปขึ้น R2 — คืน key ของไฟล์ที่อัปแล้ว */
export async function uploadFile(
  batchId: string,
  kind: "zip" | "roster" | "pdf",
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  const res = await fetch("/api/admin/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batchId, kind }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "ขอลิงก์อัปโหลดไม่สำเร็จ");
  await putWithProgress(data.url, file, data.contentType, onProgress);
  return data.key as string;
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

export type JobResult = { error: string | null; progress: Record<string, unknown> | null };

/** รอจนกว่างานเบื้องหลังจะจบ — งานที่ตรวจไฟล์ต้องรอผลจริง ไม่ใช่จบที่ "อัปโหลดขึ้นแล้ว" */
export async function waitForJob(jobId: string, timeoutMs = 300_000): Promise<JobResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`/api/admin/jobs/${jobId}`);
    if (!res.ok) continue;
    const job = await res.json();
    if (job.status === "DONE") return { error: null, progress: job.progress };
    if (job.status === "FAILED") return { error: job.error ?? "ประมวลผลไม่สำเร็จ", progress: job.progress };
  }
  return { error: "ใช้เวลานานผิดปกติ ลองรีเฟรชหน้าเพื่อดูผลอีกครั้ง", progress: null };
}
