import { headers } from "next/headers";
import Link from "next/link";
import { CertificateCard } from "@/components/CertificateCard";
import { InfoIcon, PersonIcon, SchoolIcon, SearchIcon } from "@/components/icons";
import { SearchBox } from "@/components/SearchBox";
import { MIN_QUERY_LENGTH } from "@/lib/constants";
import { ROUND_LABELS } from "@/lib/normalize";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { searchStudents, type SearchResult } from "@/lib/search";

// ผลค้นหาเปลี่ยนตามฐานข้อมูล ห้าม cache
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  // ชื่อบนเกียรติบัตรและในชีทรายชื่อเป็นอังกฤษล้วน พิมพ์ไทยมาจึงไม่มีทางเจอ
  // บอกตรง ๆ ตั้งแต่ก่อนค้น ดีกว่าให้ไปเจอ "ไม่พบ" แล้วเดาเองว่าพิมพ์ผิดตรงไหน
  const isThai = /[\u0E00-\u0E7F]/.test(query);

  let results: SearchResult[] = [];
  let rateLimited = false;

  if (query.length >= MIN_QUERY_LENGTH && !isThai) {
    const limit = checkRateLimit(clientIp(await headers()));
    if (limit.ok) results = await searchStudents(query);
    else rateLimited = true;
  }

  const searched = query.length >= MIN_QUERY_LENGTH && !rateLimited;

  return (
    <>
      {/* ไม่มีลิงก์ "ข้ามไปเนื้อหา" เพราะหน้านี้ไม่มีเมนูให้ข้าม
          กด Tab ครั้งเดียวก็ถึงช่องค้นหาแล้ว ลิงก์นั้นจึงมีแต่จะโผล่มากวนสายตา */}
      <SiteHeader />

      <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-16">
        <section className="mx-auto max-w-2xl pt-8 sm:pt-12">
          {/* ไม่ต้องอธิบายเยอะ พาดหัวบอกตรง ๆ ว่าหน้านี้ทำอะไรได้ */}
          <h1 className="text-center text-3xl font-bold leading-snug text-brand sm:text-4xl">
            ค้นหาเกียรติบัตรของลูกคุณ
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-center text-lg text-ink-soft">
            พิมพ์ชื่อภาษาอังกฤษแล้วกดค้นหา ระบบจะแสดงเกียรติบัตรทุกใบของคนนั้น ดาวน์โหลดได้ฟรี
            ไม่ต้องสมัครสมาชิก
          </p>

          <div className="mt-6 rounded-2xl border border-brand-line bg-card p-4 shadow-sm sm:p-6">
            {/* key ผูกกับคำค้น เพื่อให้ช่องกรอกถูกสร้างใหม่เมื่อคำค้นใน URL เปลี่ยน
                ไม่งั้นกดโลโก้กลับหน้าแรกแล้วข้อความเดิมจะยังค้างอยู่ในช่อง
                (React เก็บ state ของ component ไว้ ถ้าไม่ได้ถอดออกจากหน้าจอ) */}
            <SearchBox key={query} defaultValue={query} />
          </div>
        </section>

        {/* วิธีใช้แสดงเฉพาะตอนยังไม่ได้ค้น พอมีผลลัพธ์แล้วก็ไม่ต้องสอนอีก */}
        {query.length === 0 && <HowToUse />}

        <section className="mt-10">
          {/* พิมพ์ไทยมาไม่ต้องขึ้นอะไรตรงนี้ — ช่องค้นหาบอกไปแล้วว่าต้องพิมพ์อังกฤษ
              ขึ้นซ้ำสองที่จะทำให้คนอ่านสองรอบแล้วยังไม่รู้ว่าต้องไปแก้ที่ไหน */}
          {isThai && query.length > 0 ? null : rateLimited ? (
            <Notice tone="warn" title="ค้นหาถี่เกินไป">
              กรุณารอประมาณ 1 นาที แล้วกดค้นหาอีกครั้ง ข้อมูลของคุณยังอยู่ครบ
            </Notice>
          ) : query.length === 0 ? null : query.length < MIN_QUERY_LENGTH ? (
            <Notice tone="warn" title={`กรุณาพิมพ์อย่างน้อย ${MIN_QUERY_LENGTH} ตัวอักษร`}>
              ชื่อสั้นเกินไป ระบบจะหาเจอยาก ลองพิมพ์ชื่อให้ครบกว่านี้
            </Notice>
          ) : results.length === 0 ? (
            <NoResults query={query} />
          ) : (
            <div className="space-y-10">
              {/* บอกจำนวนที่พบผ่าน role=status เพื่อให้ screen reader อ่านเฉพาะบรรทัดนี้
                  ถ้าครอบ aria-live ไว้ทั้งก้อนผลลัพธ์ มันจะไล่อ่านทุกใบตั้งแต่ต้น */}
              <p role="status" className="text-lg font-medium text-ink-soft">
                พบ {results.length} ชื่อที่ตรงกับ &ldquo;{query}&rdquo;
              </p>
              {results.map((student) => (
                <StudentBlock key={student.studentId} student={student} />
              ))}
              {results.length > 1 && <SameNameHint />}
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-hairline bg-card">
      {/* แถบสามสีของธีม — ใช้สีที่ตกลงกันไว้เป็นตราสัญลักษณ์ ไม่เอาไปปนกับปุ่มหรือข้อความ */}
      <div className="flex h-1.5">
        <div className="flex-1 bg-brand" />
        <div className="flex-1 bg-flag-red" />
        <div className="flex-1 bg-flag-yellow" />
      </div>
      <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
        {/* กดโลโก้แล้วกลับไปหน้าค้นหาเปล่า ๆ (ไม่มีคำค้นติดไปด้วย)
            เป็นทางออกให้คนที่ค้นแล้วงง อยากเริ่มใหม่ — ผู้ปกครองหลายคนไม่รู้จักปุ่มย้อนกลับของเบราว์เซอร์
            ทั้งโลโก้และชื่อระบบอยู่ในลิงก์เดียวกัน เป้าจะได้ใหญ่พอสำหรับนิ้ว */}
        <Link
          href="/"
          className="-mx-2 flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1
                     transition duration-200 hover:bg-brand-soft"
        >
          {/* โลโก้อยู่ที่ public/logo.png — เปลี่ยนรูปได้โดยแทนที่ไฟล์นั้น ไม่ต้องแก้โค้ด
              เป็นโลโก้แนวนอน จึงกำหนดความสูงแล้วปล่อยความกว้างไปตามสัดส่วน
              width/height ที่ใส่ไว้คือสัดส่วนจริงของไฟล์ มีไว้จองพื้นที่ หน้าจะได้ไม่กระตุกตอนรูปโหลดมา
              alt="" เพราะชื่อระบบเป็นตัวหนังสืออยู่ข้าง ๆ แล้ว ไม่ต้องให้ screen reader อ่านซ้ำ */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt=""
            width={433}
            height={110}
            className="h-8 w-auto shrink-0 sm:h-9"
          />
          <span className="h-8 w-px shrink-0 bg-hairline" aria-hidden="true" />
          <span className="text-base font-bold leading-tight text-brand sm:text-lg">
            ระบบเกียรติบัตรออนไลน์
          </span>
        </Link>
      </div>
    </header>
  );
}

function HowToUse() {
  const steps = [
    { n: 1, title: "พิมพ์ชื่อ", detail: "ชื่อ-นามสกุลภาษาอังกฤษ ตามที่พิมพ์บนเกียรติบัตร" },
    { n: 2, title: "กดค้นหา", detail: "ระบบจะแสดงเกียรติบัตรทุกใบของคนนั้น" },
    { n: 3, title: "กดบันทึกไฟล์", detail: "ได้ไฟล์ PDF เปิดและสั่งพิมพ์ได้ทุกเครื่อง" },
  ];

  return (
    <section className="mt-10" aria-labelledby="how-to-use">
      <h2 id="how-to-use" className="text-center text-xl font-bold text-ink">
        ใช้งาน 3 ขั้นตอน
      </h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.n}
            className="rounded-2xl border border-hairline bg-card p-5 text-center shadow-sm"
          >
            <span
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full
                         bg-brand-soft text-xl font-bold text-brand"
              aria-hidden="true"
            >
              {step.n}
            </span>
            <p className="mt-3 text-lg font-semibold text-ink">{step.title}</p>
            <p className="mt-1 text-base text-ink-soft">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StudentBlock({ student }: { student: SearchResult }) {
  // แสดงชื่ออังกฤษเป็นหลัก เพราะเป็นชื่อเดียวกับที่พิมพ์อยู่บนเกียรติบัตร
  // ผู้ปกครองจะได้เทียบกับใบที่ถืออยู่ได้ตรงตัว (ชื่อไทยมีเฉพาะที่แอดมินกรอกเอง)
  const displayName = student.nameEn ?? student.nameTh ?? "ไม่ระบุชื่อ";
  // บรรทัดข้อมูลใต้ชื่อ — มีไว้ให้ผู้ปกครองรู้ว่าล่าสุดน้องอยู่ระดับชั้นไหน
  // ไม่ใช่ตัวยืนยันตัวคน (การจับคู่ใช้เลขผู้เข้าสอบหลังบ้านไปแล้ว
  // และเคสที่แยกไม่ออกถูกกันไปให้แอดมินตัดสินก่อนเผยแพร่)
  // จึงต้องมีคำกำกับว่าตัวเลขนั้นคืออะไร ไม่ใช่โยน "PRIMARY 4" มาลอย ๆ
  const detail = student.school ?? (student.latestLevel && `ระดับชั้นล่าสุด ${student.latestLevel}`);
  const counts = student.programs.map((program) => ({
    code: program.code,
    total: program.sessions.reduce((n, session) => n + session.certificates.length, 0),
  }));

  return (
    <article className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-sm">
      {/* หัวการ์ดเป็นพื้นน้ำเงินอ่อน ทำให้เห็นชัดว่าของแต่ละคนเริ่มและจบตรงไหน
          ตอนค้นชื่อที่มีหลายคน ถ้าไม่มีเส้นแบ่งชัด ๆ จะอ่านปนกัน */}
      <div className="border-b border-brand-line bg-brand-soft px-4 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <PersonIcon className="mt-1 h-6 w-6 shrink-0 text-brand" />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold leading-snug text-ink">{displayName}</h2>
            {detail && (
              <p className="mt-1 flex items-center gap-1.5 text-base font-medium text-ink">
                <SchoolIcon className="h-5 w-5 shrink-0 text-ink-soft" />
                {detail}
              </p>
            )}
            {/* แยกจำนวนตามรายการสอบ ไม่บอกแค่ยอดรวม
                ผู้ปกครองรู้อยู่แล้วว่าลูกสอบอะไรไปบ้าง ตัวเลขนี้จึงใช้เช็กได้ทันทีว่าครบไหม
                เรียงลำดับเดียวกับหัวข้อด้านล่าง เพื่อให้กวาดตาหาต่อได้เลย */}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-ink-soft">
              {counts.map((c, i) => (
                <span key={c.code}>
                  {i > 0 && <span className="mr-2 text-hairline">·</span>}
                  <span className="font-semibold text-ink">{c.code}</span> ({c.total})
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>

      {/* จัดกลุ่มตามรายการสอบก่อน แล้วค่อยแยกปีข้างใน
          เพราะผู้ปกครองมักนึกถึง "HKIMO ของลูก" ก่อน แล้วจึงค่อยเลือกปี */}
      <div className="divide-y divide-hairline">
        {student.programs.map((program) => (
          <section key={program.code} className="px-4 py-5 sm:px-6">
            <h3 className="text-xl font-bold text-brand">
              {program.name}
              <span className="ml-2 align-middle text-base font-medium text-ink-soft">
                {program.code}
              </span>
            </h3>

            {/* หัวข้อบอกทั้งปีและรอบในบรรทัดเดียว ไม่ซ้อนหัวข้ออีกชั้น
                คนหนึ่งมีไม่กี่ใบต่อรอบ ถ้าเพิ่มชั้นหัวข้อจะกลายเป็นหัวข้อที่มีของอยู่ใบเดียว
                แต่ต้องเขียนรอบให้เห็นชัด เพราะใบรอบคัดเลือกกับรอบชิงชนะเลิศของปีเดียวกัน
                หน้าตาเกือบเหมือนกัน ถ้าไม่บอกให้ชัด ผู้ปกครองจะกดผิดใบ */}
            <div className="mt-4 space-y-6">
              {program.sessions.map((session) => (
                <div key={`${session.year}-${session.round}`}>
                  <h4 className="mb-3 inline-block rounded-lg bg-gold-bg px-3 py-1 text-base font-bold text-gold-ink">
                    ปี {session.year} · {ROUND_LABELS[session.round] ?? session.round}
                  </h4>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {session.certificates.map((cert) => (
                      <CertificateCard
                        key={cert.id}
                        cert={cert}
                        programCode={program.code}
                        studentName={displayName}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

/** ไม่พบผลลัพธ์ — ห้ามจบแค่ "ไม่พบ" ต้องบอกว่าทำอะไรต่อได้
 *  ถ้าพิมพ์มาหลายคำ เสนอปุ่มค้นด้วยชื่อต้นคำเดียวให้กดได้เลย ไม่ต้องพิมพ์ใหม่
 *  (สาเหตุที่เจอบ่อยที่สุดคือนามสกุลสะกดไม่ตรงกับที่ต้นทางบันทึกไว้) */
function NoResults({ query }: { query: string }) {
  const firstWord = query.split(/\s+/)[0];
  const canTryFirstWord = firstWord.length >= MIN_QUERY_LENGTH && firstWord !== query;

  return (
    <div className="rounded-2xl border border-hairline bg-card p-6 sm:p-8">
      <h2 className="text-xl font-bold text-ink">ไม่พบเกียรติบัตรของ &ldquo;{query}&rdquo;</h2>
      <p className="mt-2 text-lg text-ink-soft">ลองวิธีเหล่านี้ทีละข้อ</p>

      <ol className="mt-4 space-y-3 text-lg">
        <li className="flex gap-3">
          <Step n={1} />
          <span>พิมพ์เฉพาะชื่อต้น ไม่ต้องใส่นามสกุล</span>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <span>ลองพิมพ์เฉพาะนามสกุล</span>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <span>ตรวจตัวสะกดให้ตรงกับที่พิมพ์บนเกียรติบัตร บางชื่อสะกดต่างจากที่เราคุ้น</span>
        </li>
      </ol>

      {canTryFirstWord && (
        <Link
          href={`/?q=${encodeURIComponent(firstWord)}`}
          className="mt-5 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl
                     bg-brand px-6 text-lg font-semibold text-white
                     transition duration-200 hover:bg-brand-dark"
        >
          <SearchIcon />
          ค้นหาด้วยคำว่า &ldquo;{firstWord}&rdquo;
        </Link>
      )}

      <p className="mt-6 flex items-start gap-2 border-t border-hairline pt-4 text-base text-ink-soft">
        <InfoIcon className="mt-0.5 h-5 w-5 shrink-0" />
        ถ้าลองครบแล้วยังไม่พบ อาจเป็นเพราะเจ้าหน้าที่ยังไม่ได้นำเกียรติบัตรรอบนั้นเข้าระบบ
        กรุณาสอบถามที่ผู้ประสานงานสนามสอบของคุณ
      </p>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft
                 text-base font-bold text-brand"
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

/** ขึ้นเฉพาะตอนผลค้นมีหลายคนให้เลือก — เป็นการบอกทาง ไม่ใช่สั่งให้ไปตรวจสอบระบบ
 *  ความถูกต้องของว่าใบไหนเป็นของใคร จบไปแล้วตอนจับคู่หลังบ้านด้วยเลขผู้เข้าสอบ
 *  ที่ยังเหลือเป็นหน้าที่ของผู้ปกครองคือเลือกว่าคนไหนคือลูกตัวเอง */
function SameNameHint() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-gold-bg px-4 py-3 text-base text-gold-ink">
      <InfoIcon className="mt-0.5 h-5 w-5 shrink-0" />
      มีผู้เข้าสอบชื่อคล้ายกันหลายคน เลือกให้ตรงกับลูกคุณก่อนบันทึกไฟล์
    </p>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "info" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === "warn"
      ? "border-gold-line bg-gold-bg text-gold-ink"
      : "border-brand-line bg-brand-soft text-ink";
  return (
    <div className={`rounded-2xl border px-5 py-6 text-center ${styles}`}>
      <p className="text-xl font-bold">{title}</p>
      <p className="mt-1 text-lg">{children}</p>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-card">
      <div className="mx-auto max-w-5xl px-4 py-6 text-base text-ink-soft">
        <p>ระบบเกียรติบัตรออนไลน์ · ไฟล์ที่ได้เป็น PDF เปิดและสั่งพิมพ์ได้ทุกเครื่อง</p>
        <p className="mt-1">
          หากข้อมูลบนเกียรติบัตรไม่ถูกต้อง กรุณาแจ้งผู้ประสานงานสนามสอบ ไม่ต้องแก้ไฟล์เอง
        </p>
      </div>
    </footer>
  );
}
