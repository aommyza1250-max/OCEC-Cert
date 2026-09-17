/** อ่านและตรวจ env ตอนบูต — พังตั้งแต่ตอนสตาร์ท ดีกว่าพังตอนผู้ใช้กำลังใช้งาน */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),

  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.string().url(),
  R2_PUBLIC_BASE_URL: z.string().url(),
  R2_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD ต้องยาวอย่างน้อย 8 ตัวอักษร"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET ต้องยาวอย่างน้อย 16 ตัวอักษร"),

  WORKER_BASE_URL: z.string().url(),
  WORKER_SHARED_SECRET: z.string().min(8),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`ตั้งค่า environment ไม่ครบ:\n${missing}\n\nดูรายการทั้งหมดได้ที่ .env.example`);
  }
  cached = parsed.data;
  return cached;
}
