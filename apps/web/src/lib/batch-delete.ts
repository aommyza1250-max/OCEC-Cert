/**
 * ข้อความยืนยันการลบรอบการนำเข้า
 *
 * อยู่ไฟล์กลางเพราะทั้งฝั่งที่แสดงให้แอดมินพิมพ์ตาม และฝั่งที่ตรวจว่าพิมพ์ถูกไหม
 * ต้องใช้สูตรเดียวกันเป๊ะ ถ้าเหลื่อมกันแอดมินจะพิมพ์ตามที่เห็นบนจอแล้วโดนปฏิเสธ
 */
import type { ExamRound } from "@prisma/client";

export function batchConfirmPhrase(code: string, round: ExamRound, year: number): string {
  return `${code} ${round} ${year}`.toUpperCase();
}
