import { AUDIT_LABELS } from "@/lib/audit";

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  sessionId: string;
  createdAt: string;
  before: unknown;
  after: unknown;
};

/**
 * ประวัติการแก้ไข — ตอบได้ว่าอะไรเปลี่ยนจากอะไรเป็นอะไร เมื่อไหร่ จาก session ไหน
 *
 * ทุกคนใช้รหัสผ่านเดียวกัน จึงแสดงได้แค่รหัส session ไม่ใช่ชื่อคน — ห้ามแสดงราวกับรู้ว่าใครทำ
 */
export function AuditTrail({ events, empty = "ยังไม่มีการแก้ไข" }: { events: AuditRow[]; empty?: string }) {
  if (events.length === 0) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="rounded-lg border border-hairline bg-card px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{AUDIT_LABELS[e.action] ?? e.action}</span>
            <span className="text-ink-soft">
              {new Date(e.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} · session{" "}
              <code>{e.sessionId.slice(0, 8)}</code>
            </span>
          </div>
          <Change before={e.before} after={e.after} />
        </li>
      ))}
    </ol>
  );
}

/** แสดงเฉพาะช่องที่เปลี่ยน — ถ้าไม่มีค่าเดิม แสดงค่าใหม่ทั้งหมด */
function Change({ before, after }: { before: unknown; after: unknown }) {
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
  if (keys.length === 0) return null;
  return (
    <dl className="mt-1 grid gap-x-3 text-ink-soft sm:grid-cols-[auto_1fr]">
      {keys.slice(0, 8).map((k) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd className="min-w-0 break-words">
            {k in b && <span className="line-through">{show(b[k])}</span>}
            {k in b && k in a && " → "}
            {k in a && <span className="text-ink">{show(a[k])}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
