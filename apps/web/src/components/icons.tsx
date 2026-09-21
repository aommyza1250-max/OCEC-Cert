/** ไอคอนทั้งหมดของหน้าสาธารณะ — เป็น SVG ไม่ใช่ emoji
 *  (emoji แสดงผลไม่เหมือนกันในแต่ละเครื่อง และ screen reader อ่านออกมาแปลก ๆ)
 *
 *  ทุกตัวเป็น aria-hidden เพราะเป็นของประกอบข้อความที่อยู่ข้าง ๆ เสมอ
 *  ไม่มีที่ไหนในหน้านี้ที่ใช้ไอคอนเดี่ยว ๆ แทนคำอธิบาย */
type IconProps = { className?: string };

const base = "h-5 w-5 shrink-0";

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className ?? base}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  );
}

export function ZoomIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function MedalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="15" r="6" />
      <path d="M8.5 9 6 3h12l-2.5 6" />
    </Svg>
  );
}

export function SchoolIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10 12 5l9 5-9 5z" />
      <path d="M7 12.5V18c0 1 2.2 2 5 2s5-1 5-2v-5.5" />
    </Svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </Svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/** วงกลมหมุนตอนกำลังค้นหา — ไม่ใช้เส้นประ เพราะบางเครื่องเรนเดอร์กระตุก */
export function Spinner({ className }: IconProps) {
  return (
    <svg
      className={`${className ?? base} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={3} opacity={0.25} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Svg>
  );
}

export function PdfIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  );
}
