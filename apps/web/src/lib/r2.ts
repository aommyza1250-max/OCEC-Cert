/** ตัวเชื่อมกับ Cloudflare R2 (dev ใช้ MinIO ซึ่งเป็น S3-compatible เหมือนกัน) */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

let client: S3Client | null = null;

function s3() {
  if (client) return client;
  const e = env();
  client = new S3Client({
    region: "auto", // R2 ไม่มีแนวคิด region ต้องใส่ "auto"
    endpoint: e.R2_ENDPOINT,
    forcePathStyle: e.R2_FORCE_PATH_STYLE, // MinIO ต้องเป็น true
    credentials: {
      accessKeyId: e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/** URL สาธารณะของไฟล์ preview — เสิร์ฟผ่าน CDN ไม่กิน bandwidth ของ Railway */
export function publicUrl(key: string) {
  return `${env().R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}

/**
 * ลิงก์ดาวน์โหลดไฟล์แบบมีอายุ
 * ใช้ presigned แทน public URL เพื่อไม่ให้ใครไล่เดา key แล้วดูดไฟล์ทั้ง bucket
 * ตั้งค่า ResponseContentType เป็น application/octet-stream เป็นค่าตั้งต้น
 * เพื่อบังคับให้ Safari บน iOS เด้งหน้าต่างดาวน์โหลดของระบบแทนที่จะเปิดแท็บพรีวิว
 */
export async function presignedDownloadUrl(
  key: string,
  filename: string,
  contentType = "application/octet-stream",
  expiresIn = 900,
) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env().R2_BUCKET,
      Key: key,
      // บังคับให้เบราว์เซอร์ดาวน์โหลดพร้อมตั้งชื่อไฟล์ แทนที่จะเปิดในแท็บ
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
      ResponseContentType: contentType,
    }),
    { expiresIn },
  );
}

/**
 * ลิงก์อัปโหลดแบบมีอายุ — เบราว์เซอร์ของแอดมินยิงไฟล์ขึ้น R2 ตรง ๆ
 * ห้ามให้ไฟล์ PDF รวมเล่ม (หลายร้อย MB) วิ่งผ่าน Next.js API เพราะ Railway จะกินแรมจนล่ม
 */
export async function presignedUploadUrl(key: string, contentType: string, expiresIn = 900) {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: env().R2_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

/** ตั้งชื่อ key ให้เป็นระเบียบ เดาไม่ได้ และรู้ว่าไฟล์ของ batch ไหน
 *  ส่วนของเกียรติบัตรรายคน worker เป็นคนตั้งชื่อ (ดู apps/worker/app/storage.py)
 *  รูปแบบคือ {FNAME}_{LNAME}_{รายการสอบ}_{รอบ}_{รางวัล}_{ปี} ตาม docs/data-intake-spec.md
 *
 *  ต้นฉบับทุกชนิดได้ชื่อใหม่ทุกครั้งที่อัป ไม่เขียนทับของเดิม — รอบนำเข้าหนึ่งอัปได้หลายครั้ง
 *  และต้องย้อนกลับไปดูได้ว่าใบไหนมาจากไฟล์ไหน รายชื่อที่ตรวจไม่ผ่านก็ต้องไม่ทับไฟล์ของชุดที่ใช้อยู่ */
export const keys = {
  sourceZip: (batchId: string, stamp: string) => `sources/${batchId}/bundle-${stamp}.zip`,
  roster: (batchId: string, stamp: string) => `sources/${batchId}/roster-${stamp}.xlsx`,
  /** PDF ที่แอดมินอัปให้ผู้เข้าสอบคนใดคนหนึ่ง (เพิ่มใบที่ขาด หรือเปลี่ยนไฟล์) */
  certificatePdfSource: (batchId: string, stamp: string) => `sources/${batchId}/pdf-${stamp}.pdf`,
};

/** key ของไฟล์ต้นฉบับต้องอยู่ใต้โฟลเดอร์ของรอบนำเข้านั้นเท่านั้น — กันไม่ให้ชี้ไปไฟล์ของรอบอื่น */
export function isSourceKeyOf(batchId: string, key: string) {
  return key.startsWith(`sources/${batchId}/`) && !key.includes("..");
}
