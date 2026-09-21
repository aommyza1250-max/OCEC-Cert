import { ROUND_LABELS } from "@/lib/normalize";
import type { CertificateItem } from "@/lib/search";
import { AwardBadge } from "./AwardBadge";
import { ImageIcon, PdfIcon } from "./icons";
import { PreviewLightbox } from "./PreviewLightbox";

/** เกียรติบัตร 1 ใบ
 *
 *  ลำดับที่ตาไล่อ่าน: รูป -> รางวัล -> ปุ่มบันทึกรูปภาพ (ปุ่มหลัก) -> ปุ่มดาวน์โหลด PDF (ปุ่มรอง)
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

      {/* ส่วนปุ่มดาวน์โหลด: ปุ่มบันทึกรูปภาพใหญ่และเด่นที่สุด (Hero Button)
          และปุ่ม PDF ขนาดกะทัดรัดเป็นทางเลือกเสริมสำหรับสั่งพิมพ์ */}
      <div className="flex flex-col gap-2 pt-1">
        {/* ปุ่มที่ 1: บันทึกรูปภาพ (.webp) — ปุ่มหลัก ขนาดใหญ่ เด่นชัดที่สุด */}
        <a
          href={`/api/certificates/${cert.id}/download?format=image`}
          download
          className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl
                     bg-brand px-4 text-center font-semibold text-white shadow-sm transition duration-200
                     hover:bg-brand-dark active:scale-[0.99] sm:min-h-14 sm:text-lg"
          aria-label={`บันทึกรูปภาพเกียรติบัตรของ ${studentName}`}
        >
          <ImageIcon className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          <span>บันทึกรูปภาพ</span>
        </a>

        {/* ปุ่มที่ 2: ดาวน์โหลดไฟล์ PDF — ปุ่มรอง ขนาดกะทัดรัด สำหรับผู้ที่ต้องการพิมพ์ */}
        <a
          href={`/api/certificates/${cert.id}/download`}
          download
          className="flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg
                     border border-hairline bg-paper/60 px-3 text-center text-xs font-medium
                     text-ink-soft transition duration-200 hover:bg-paper hover:text-ink
                     active:scale-[0.99] sm:min-h-10 sm:text-sm"
          aria-label={`ดาวน์โหลดไฟล์ PDF เกียรติบัตรของ ${studentName}`}
        >
          <PdfIcon className="h-4 w-4 shrink-0 opacity-80" />
          <span>ดาวน์โหลดไฟล์ PDF (สำหรับพิมพ์)</span>
        </a>
      </div>
    </div>
  );
}
