import { publicAwardLabel, publicRoundLabel } from "@/lib/public-labels";
import type { CertificateItem } from "@/lib/search";
import { AwardBadge } from "./AwardBadge";
import { ImageIcon } from "./icons";
import { PreviewLightbox } from "./PreviewLightbox";

/** เกียรติบัตร 1 ใบ
 *
 *  ลำดับที่ตาไล่อ่าน: รูป -> รางวัล -> ปุ่มบันทึกรูปภาพ
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
  const roundLabel = publicRoundLabel(cert.round);

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
        <AwardBadge label={publicAwardLabel(cert.award, cert.awardLabel)} badge={cert.badge} />
        {/* ระดับชั้นกับเลขที่ใบอยู่บรรทัดเดียวกันบนมือถือ ลดจำนวนบรรทัดต่อการ์ด
            เพราะหน้าผลลัพธ์อาจมีหลายใบเรียงกันยาว */}
        <p className="mt-1.5 text-xs text-ink-soft sm:mt-2 sm:text-sm">
          {cert.level && <span className="inline-block max-w-full break-words">{cert.level}</span>}
          {cert.certNo && (
            <span className="whitespace-nowrap">
              {cert.level && <span className="px-1.5">·</span>}
              เลขที่ {cert.certNo}
            </span>
          )}
        </p>
      </div>

      {/* บันทึกรูป WebP ไฟล์เดียวกับที่ใช้แสดง */}
      <div className="flex flex-col gap-2 pt-1">
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

      </div>
    </div>
  );
}
