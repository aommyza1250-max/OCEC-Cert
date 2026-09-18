import { ROUND_LABELS } from "@/lib/normalize";
import type { CertificateItem } from "@/lib/search";
import { AwardBadge } from "./AwardBadge";
import { DownloadIcon } from "./icons";
import { PreviewLightbox } from "./PreviewLightbox";

/** เกียรติบัตร 1 ใบ
 *
 *  ลำดับที่ตาไล่อ่าน: รูป -> รางวัล -> ปุ่มดาวน์โหลด
 *  ไม่เขียนรอบซ้ำบนการ์ด เพราะหัวข้อด้านบนบอกไปแล้วว่ากลุ่มนี้เป็นรอบไหนของปีไหน
 *  ระดับชั้นกับเลขที่ใบอยู่ตัวเล็กใต้รางวัล คนส่วนใหญ่ไม่ได้มาหาสิ่งนี้
 *  แต่คนที่ต้องใช้ (เช่นโทรไปสอบถามเจ้าหน้าที่) ต้องหาเจอโดยไม่ต้องกดเปิดอะไรเพิ่ม */
export function CertificateCard({
  cert,
  programCode,
  studentName,
}: {
  cert: CertificateItem;
  programCode: string;
  studentName: string;
}) {
  const roundLabel = ROUND_LABELS[cert.round] ?? cert.round;

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-hairline bg-card p-2.5 shadow-sm sm:gap-3 sm:p-3">
      {cert.previewUrl ? (
        <PreviewLightbox
          src={cert.previewUrl}
          alt={`เกียรติบัตร ${programCode} ${roundLabel} ปี ${cert.year} ของ ${studentName}`}
        />
      ) : (
        <div className="flex aspect-[842/595] w-full items-center justify-center rounded-xl bg-paper text-base text-ink-soft">
          ไม่มีรูปตัวอย่าง
        </div>
      )}

      <div className="flex-1 px-1">
        <AwardBadge award={cert.award} />
        {/* ระดับชั้นกับเลขที่ใบอยู่บรรทัดเดียวกันบนมือถือ ลดจำนวนบรรทัดต่อการ์ด
            เพราะหน้าผลลัพธ์อาจมีหลายใบเรียงกันยาว */}
        <p className="mt-1.5 text-sm text-ink-soft sm:mt-2 sm:text-base">
          {cert.level}
          {cert.level && cert.certNo && <span className="px-1.5">·</span>}
          {cert.certNo && <span className="whitespace-nowrap">เลขที่ {cert.certNo}</span>}
        </p>
      </div>

      {/* ปุ่มเดียวที่ต้องกด ทำให้ใหญ่และเต็มความกว้างการ์ด
          ลิงก์ตรงไป R2 ผ่าน redirect — ไฟล์ไม่วิ่งผ่านเซิร์ฟเวอร์เว็บ */}
      <a
        href={`/api/certificates/${cert.id}/download`}
        className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl
                   bg-brand px-4 text-center font-semibold text-white transition duration-200
                   hover:bg-brand-dark active:scale-[0.99] sm:min-h-12 sm:text-lg"
      >
        <DownloadIcon />
        บันทึกไฟล์
      </a>
    </div>
  );
}
