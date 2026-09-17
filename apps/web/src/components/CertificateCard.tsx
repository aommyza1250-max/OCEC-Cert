import type { CertificateItem } from "@/lib/search";
import { PreviewLightbox } from "./PreviewLightbox";

export function CertificateCard({
  cert,
  programCode,
  studentName,
}: {
  cert: CertificateItem;
  programCode: string;
  studentName: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      {cert.previewUrl ? (
        <PreviewLightbox
          src={cert.previewUrl}
          alt={`เกียรติบัตร ${programCode} ปีการศึกษา ${cert.academicYear} ของ ${studentName}`}
        />
      ) : (
        <div className="flex aspect-[842/595] w-full items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400">
          ไม่มีรูปตัวอย่าง
        </div>
      )}

      <div className="flex-1">
        {cert.level && <p className="font-semibold leading-snug">{cert.level}</p>}
        {cert.award && (
          <span className="mt-2 inline-block rounded-full bg-[var(--color-brand-soft)] px-3 py-1 text-sm font-medium text-[var(--color-brand)]">
            {cert.award}
          </span>
        )}
        {cert.certNo && (
          <p className="mt-2 text-xs text-gray-400">เลขที่ {cert.certNo}</p>
        )}
      </div>

      {/* ลิงก์ตรงไป R2 ผ่าน redirect — ไฟล์ไม่วิ่งผ่านเซิร์ฟเวอร์เว็บ */}
      <a
        href={`/api/certificates/${cert.id}/download`}
        className="rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:brightness-110"
      >
        ดาวน์โหลด PDF
      </a>
    </div>
  );
}
