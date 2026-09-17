import { env } from "./env";

/**
 * ปลุก worker ให้มาหยิบงานทันที
 *
 * ตั้งใจไม่ throw เมื่อเรียกไม่สำเร็จ เพราะงานถูกเขียนลงตาราง jobs ไปแล้ว
 * ถ้า worker กำลังรีสตาร์ทอยู่พอดี เดี๋ยวรอบ poll ถัดไปก็หยิบไปทำเอง
 * การทำให้คำขอของแอดมินพังทั้งอันเพราะเรื่องนี้ไม่คุ้ม
 */
export async function wakeWorker(): Promise<boolean> {
  try {
    const res = await fetch(`${env().WORKER_BASE_URL.replace(/\/$/, "")}/wake`, {
      method: "POST",
      headers: { "x-worker-secret": env().WORKER_SHARED_SECRET },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
