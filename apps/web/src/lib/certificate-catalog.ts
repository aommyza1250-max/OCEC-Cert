/**
 * แคตตาล็อกรางวัลและโปรไฟล์เกียรติบัตร (ฝั่งเว็บ)
 *
 * อ่านไฟล์ชุดเดียวกับ worker ที่ shared/certificate-profiles/*.json
 * ชื่อรางวัลที่ผู้ปกครองเห็น กับชื่อโฟลเดอร์ที่ worker ยอมรับ จึงมาจากที่เดียวกันเสมอ
 *
 * ⚠️ folderKey() ต้องให้ผลตรงกับ folder_key() ใน apps/worker/app/certificate_profiles/manifest.py
 * เคสทดสอบร่วมอยู่ที่ shared/certificate-profile-cases.json
 *
 * เว็บไม่ได้อ่านหน้าเกียรติบัตรเอง — ใช้ไฟล์นี้แค่ตรวจว่ารายการ/รอบไหนรองรับ
 * แสดงชื่อรางวัล และจำกัดตัวเลือกตอนแอดมินเปลี่ยนรางวัล
 */
import { z } from "zod";
import { basicClean } from "./normalize";
import bbb from "../../../../shared/certificate-profiles/bbb.json";
import hkico from "../../../../shared/certificate-profiles/hkico.json";
import hkimo from "../../../../shared/certificate-profiles/hkimo.json";
import hkiso from "../../../../shared/certificate-profiles/hkiso.json";
import timo from "../../../../shared/certificate-profiles/timo.json";

export const ROUNDS = ["HEAT", "FINAL"] as const;
export type ExamRoundCode = (typeof ROUNDS)[number];

const roundSchema = z.enum(ROUNDS);

const awardSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  labelTh: z.string().optional(),
  kind: z.enum(["PRIMARY", "SUPPLEMENTAL"]),
  rounds: z.array(roundSchema).min(1),
  folders: z.array(z.string()).min(1),
  text: z.array(z.string()).optional(),
  order: z.number().int(),
  badge: z.string().min(1),
});

const manifestSchema = z.object({
  program: z.string().regex(/^[A-Z0-9_]+$/),
  name: z.string().min(1),
  rounds: z.record(
    roundSchema,
    z.object({ profileKey: z.string().min(1), levelSubfolder: z.boolean() }),
  ),
  awards: z.array(awardSchema).min(1),
});

export type AwardDef = {
  code: string;
  label: string;
  labelTh: string | null;
  kind: "PRIMARY" | "SUPPLEMENTAL";
  rounds: ExamRoundCode[];
  /** ชื่อโฟลเดอร์ที่ยอมรับ ในรูป folderKey แล้ว */
  folders: string[];
  order: number;
  badge: string;
};

type ProgramManifest = {
  program: string;
  name: string;
  profileKeys: Partial<Record<ExamRoundCode, string>>;
  awards: AwardDef[];
};

/**
 * รูปที่ใช้เทียบชื่อโฟลเดอร์: ไม่สนตัวพิมพ์ ขีดล่าง และช่องว่างซ้ำ
 * 'Perfect_Score', 'perfect score' -> 'PERFECT SCORE'
 */
export function folderKey(name: string | null | undefined): string {
  return basicClean(name);
}

function load(raw: unknown, source: string): ProgramManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${source}: รูปแบบแคตตาล็อกรางวัลไม่ถูกต้อง — ${parsed.error.issues[0]?.message}`);
  }
  const data = parsed.data;
  const profileKeys: ProgramManifest["profileKeys"] = {};
  for (const round of ROUNDS) {
    const config = data.rounds[round];
    if (!config) continue;
    if (config.profileKey !== `${data.program}_${round}`) {
      throw new Error(`${source}: profileKey ของรอบ ${round} ต้องเป็น ${data.program}_${round}`);
    }
    profileKeys[round] = config.profileKey;
  }

  const owner = new Map<string, string>();
  const awards = data.awards.map((award) => {
    const keys = [...new Set([...award.folders, ...(award.text ?? [])].map(folderKey).filter(Boolean))];
    for (const key of keys) {
      const existing = owner.get(key);
      if (existing && existing !== award.code) {
        throw new Error(`${source}: ชื่อ '${key}' ถูกใช้ทั้งใน ${existing} และ ${award.code}`);
      }
      owner.set(key, award.code);
    }
    return {
      code: award.code,
      label: award.label,
      labelTh: award.labelTh ?? null,
      kind: award.kind,
      rounds: award.rounds,
      folders: [...new Set(award.folders.map(folderKey).filter(Boolean))],
      order: award.order,
      badge: award.badge,
    } satisfies AwardDef;
  });

  return {
    program: data.program,
    name: data.name,
    profileKeys,
    awards: awards.sort((a, b) => a.order - b.order || a.code.localeCompare(b.code)),
  };
}

const MANIFESTS: Map<string, ProgramManifest> = new Map(
  [
    [bbb, "bbb.json"],
    [hkico, "hkico.json"],
    [hkimo, "hkimo.json"],
    [hkiso, "hkiso.json"],
    [timo, "timo.json"],
  ].map(([raw, source]) => {
    const manifest = load(raw, source as string);
    return [manifest.program, manifest];
  }),
);

export function programManifests(): ProgramManifest[] {
  return [...MANIFESTS.values()];
}

/**
 * โปรไฟล์ของรายการ/รอบนี้ — null = ระบบยังอ่านเกียรติบัตรแบบนี้ไม่ได้ ห้ามเริ่มนำเข้า
 * รายการสอบที่แอดมินสร้างเองมีได้ แต่ถ้ายังไม่มีโปรไฟล์ก็นำเข้าไม่ได้ ไม่มีโปรไฟล์กลางให้ถอยไปใช้
 */
export function profileKeyFor(programCode: string, round: string): string | null {
  const manifest = MANIFESTS.get(programCode.toUpperCase());
  return manifest?.profileKeys[round as ExamRoundCode] ?? null;
}

/** รางวัลที่ใช้ได้ในรอบนี้ เรียงตามลำดับการแสดงผล */
export function awardCatalog(programCode: string, round: string): AwardDef[] {
  const manifest = MANIFESTS.get(programCode.toUpperCase());
  if (!manifest || !manifest.profileKeys[round as ExamRoundCode]) return [];
  return manifest.awards.filter((a) => a.rounds.includes(round as ExamRoundCode));
}

export function findAward(programCode: string, code: string): AwardDef | null {
  return MANIFESTS.get(programCode.toUpperCase())?.awards.find((a) => a.code === code) ?? null;
}

/** ชื่อโฟลเดอร์ -> รหัสรางวัล ต้องตรงกับชื่อที่ประกาศไว้เท่านั้น ไม่เดา */
export function resolveAwardFolder(programCode: string, round: string, folder: string): string | null {
  const key = folderKey(folder);
  if (!key) return null;
  return awardCatalog(programCode, round).find((a) => a.folders.includes(key))?.code ?? null;
}

/** ชื่อรางวัลที่แสดงผล
 *
 *  ใช้ชื่อที่บันทึกไว้กับเกียรติบัตรตอนออกใบก่อนเสมอ (snapshot) เพื่อให้ใบเก่าไม่เปลี่ยนชื่อ
 *  เวลาแก้แคตตาล็อก ถ้าไม่มี (ข้อมูลจากระบบเดิม) ค่อยหาจากแคตตาล็อก แล้วถอยไปใช้รหัส */
export function awardDisplay(
  programCode: string,
  code: string,
  snapshot?: { label?: string | null; labelTh?: string | null },
): { label: string; labelTh: string | null; badge: string; order: number } {
  const def = findAward(programCode, code) ?? LEGACY_AWARDS[code] ?? null;
  return {
    label: snapshot?.label ?? def?.label ?? code,
    labelTh: snapshot?.labelTh ?? def?.labelTh ?? null,
    badge: def?.badge ?? "neutral",
    order: def?.order ?? 999,
  };
}

/** รางวัลของข้อมูลชุดเดิม (ก่อนมีแคตตาล็อกรายการ) — ใช้เป็นทางถอยเท่านั้น */
const LEGACY_AWARDS: Record<string, AwardDef> = Object.fromEntries(
  (MANIFESTS.get("HKIMO")?.awards ?? []).map((a) => [a.code, a]),
);
