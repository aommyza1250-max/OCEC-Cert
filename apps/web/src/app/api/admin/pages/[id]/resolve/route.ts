import { Prisma, type MatchStatus, type StagingPage } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { afterCommit, enqueueRematch, withBatchMutation, type GuardedBatch, type Tx } from "@/lib/batch-guard";
import { awardCatalog } from "@/lib/certificate-catalog";
import { prisma } from "@/lib/db";
import { adminHandler, HttpError, parseBody } from "@/lib/http";
import { STALE_MESSAGE } from "@/lib/participants";

const version = z.number().int();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("USE_ROSTER_MODE"), version }),
  z.object({ action: z.literal("CONFIRM_NATIONALITY"), version }),
  z.object({ action: z.literal("MARK_FOREIGN"), version }),
  z.object({ action: z.literal("ACCEPT_PARSE"), version }),
  // เลือกผู้เข้าสอบด้วย id (จากรายการตัวเลือก) หรือด้วยเลข (หน้าที่อ่านเลขไม่ได้ แอดมินพิมพ์เลขเอง)
  z.object({
    action: z.literal("LINK_ENTRY"),
    version,
    entryId: z.string().uuid().optional(),
    candidateNo: z.string().trim().min(1).optional(),
  }),
  z.object({ action: z.literal("DISCARD"), version }),
  z.object({ action: z.literal("RESTORE"), version }),
  z.object({ action: z.literal("RECLASSIFY"), version, awardCode: z.string(), confirm: z.literal(true) }),
  z.object({ action: z.literal("USE_THIS"), version }),
]);

/** สถานะที่ตัวจับคู่คำนวณใหม่ได้ — ต้องตรงกับ EVALUABLE ใน apps/worker/app/tasks/match.py */
const EVALUABLE: MatchStatus[] = ["UNMATCHED", "MATCHED", "NAME_MISMATCH", "MODE_MISMATCH", "AMBIGUOUS", "DUPLICATE_NAME"];
const DISCARDABLE: MatchStatus[] = [...EVALUABLE, "NATIONALITY_UNVERIFIED", "PARSE_REVIEW"];

/**
 * ตัดสินหน้าที่ระบบไม่ยอมเดาให้ — ทุกการตัดสินบันทึกไว้บนหน้า (ตัวจับคู่รอบถัดไปรักษาไว้)
 * และลง audit_events แล้วจับคู่ใหม่ทันที
 *
 * การตัดสินที่ผูกกับข้อมูลในรายชื่อ (ผูกหน้ากับคน, ใช้รูปแบบตามรายชื่อ) ถ้ารายชื่อเปลี่ยนภายหลัง
 * ตัวจับคู่จะไม่เชื่อต่อเงียบ ๆ แต่ส่งกลับมาให้ตรวจใหม่
 */
export const POST = adminHandler<{ id: string }>(async (request, { params, session }) => {
  const input = await parseBody(request, schema);
  const found = await prisma.stagingPage.findUnique({ where: { id: params.id }, select: { batchId: true } });
  if (!found) throw new HttpError(404, "ไม่พบหน้านี้");

  await withBatchMutation(found.batchId, async (tx, batch) => {
    const page = await tx.stagingPage.findFirst({ where: { id: params.id, batchId: batch.id } });
    if (!page) throw new HttpError(404, "ไม่พบหน้านี้");
    if (page.version !== input.version) throw new HttpError(409, STALE_MESSAGE, { code: "STALE" });
    const action = await ACTIONS[input.action](tx, batch, page, input as never);
    await recordAudit(tx, batch, {
      entityType: "STAGING_PAGE",
      entityId: page.id,
      action: action.audit,
      before: { status: page.matchStatus, award: page.awardOverride ?? page.award, ...action.before },
      after: action.after,
      sessionId: session.sessionId,
    });
    await enqueueRematch(tx, batch.id);
  });

  await afterCommit();
  return NextResponse.json({ ok: true });
});

type Outcome = { audit: AuditAction; before?: Record<string, unknown>; after: Prisma.InputJsonValue };
type Action<I> = (tx: Tx, batch: GuardedBatch, page: StagingPage, input: I) => Promise<Outcome>;

/** แก้หน้าพร้อมเพิ่มเวอร์ชัน — มีคนตัดสินตัดหน้าระหว่างนั้น จะไม่มีแถวไหนถูกแก้ */
async function save(tx: Tx, page: StagingPage, data: Prisma.StagingPageUncheckedUpdateManyInput) {
  const { count } = await tx.stagingPage.updateMany({
    where: { id: page.id, version: page.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) throw new HttpError(409, STALE_MESSAGE, { code: "STALE" });
}

function requireStatus(page: StagingPage, allowed: MatchStatus[], message: string) {
  if (!allowed.includes(page.matchStatus)) throw new HttpError(409, message);
}

function reviewOf(page: StagingPage): Record<string, unknown> {
  return (page.review as Record<string, unknown>) ?? {};
}

const ACTIONS: { [K in z.infer<typeof schema>["action"]]: Action<Extract<z.infer<typeof schema>, { action: K }>> } = {
  /** ใช้รูปแบบตามรายชื่อ — ได้เฉพาะเมื่อเลขและชื่อตรงกันแล้ว (ซึ่งคือความหมายของ MODE_MISMATCH) */
  async USE_ROSTER_MODE(tx, _batch, page) {
    requireStatus(page, ["MODE_MISMATCH"], "หน้านี้ไม่ได้ติดเรื่องรูปแบบการสอบ");
    const entry = page.rosterEntryId && (await tx.rosterEntry.findUnique({ where: { id: page.rosterEntryId } }));
    if (!entry) throw new HttpError(409, "ไม่พบผู้เข้าสอบที่หน้านี้ผูกอยู่ กรุณาโหลดหน้าใหม่");
    await save(tx, page, { modeConfirmedFor: entry.examMode, modeConfirmedAt: new Date() });
    return {
      audit: "MODE_MISMATCH_CONFIRMED",
      before: { zipMode: page.examMode },
      after: { rosterMode: entry.examMode, candidateNo: entry.candidateNo },
    };
  },

  async CONFIRM_NATIONALITY(tx, _batch, page) {
    requireStatus(page, ["NATIONALITY_UNVERIFIED"], "หน้านี้ไม่ได้รอยืนยันสัญชาติ");
    await save(tx, page, { matchStatus: "UNMATCHED", nationalityConfirmedAt: new Date() });
    return { audit: "NATIONALITY_CONFIRMED", after: { status: "UNMATCHED" } };
  },

  async MARK_FOREIGN(tx, _batch, page) {
    requireStatus(page, ["NATIONALITY_UNVERIFIED"], "หน้านี้ไม่ได้รอยืนยันสัญชาติ");
    await save(tx, page, { matchStatus: "SKIPPED_FOREIGN" });
    return { audit: "MARKED_FOREIGN", after: { status: "SKIPPED_FOREIGN" } };
  },

  /**
   * รับหน้าที่รอบ/ปีไม่ตรง — รอบ Final ยังต้องผ่านเรื่องสัญชาติอีกด่าน
   * ตั้งใจไม่ตัดสินสัญชาติเองที่นี่ (ตรงนั้นเป็นของโปรไฟล์ฝั่ง worker) จึงส่งไปรอยืนยันทุกหน้า
   * ที่ไม่ได้พิมพ์ว่า THAILAND ไว้ชัด ๆ
   */
  async ACCEPT_PARSE(tx, batch, page) {
    requireStatus(page, ["PARSE_REVIEW"], "หน้านี้ไม่ได้รอตรวจรอบ/ปี");
    const thai = (page.countryOnPage ?? "").trim().toUpperCase() === "THAILAND";
    const status: MatchStatus = batch.round === "FINAL" && !thai ? "NATIONALITY_UNVERIFIED" : "UNMATCHED";
    await save(tx, page, { matchStatus: status, parseAcceptedAt: new Date() });
    return { audit: "PARSE_REVIEW_ACCEPTED", after: { status } };
  },

  /** ผูกหน้านี้กับผู้เข้าสอบด้วยมือ — ข้ามการตรวจชื่อ แต่ยังตรวจรูปแบบการสอบและใบซ้ำตามปกติ */
  async LINK_ENTRY(tx, batch, page, input) {
    requireStatus(page, ["UNMATCHED", "AMBIGUOUS", "NAME_MISMATCH"], "หน้านี้ผูกด้วยมือไม่ได้ในสถานะนี้");
    if (!input.entryId && !input.candidateNo) throw new HttpError(400, "กรุณาเลือกผู้เข้าสอบ");
    const entry = await tx.rosterEntry.findFirst({
      where: input.entryId
        ? { id: input.entryId, batchId: batch.id }
        : { candidateNo: input.candidateNo, batchId: batch.id },
    });
    if (!entry) throw new HttpError(404, input.candidateNo ? `ไม่มีเลข ${input.candidateNo} ในรายชื่อ` : "ไม่พบผู้เข้าสอบที่เลือก");
    if (page.certNo && page.certNo !== entry.candidateNo) {
      throw new HttpError(
        409,
        `เลขบนหน้า (${page.certNo}) ไม่ตรงกับเลขของผู้เข้าสอบที่เลือก (${entry.candidateNo}) — ` +
          "ถ้าเลขในรายชื่อผิด ให้แก้เลขในรายชื่อแทน",
      );
    }
    // ค่าที่ใช้ยืนยันว่าการผูกนี้ยังใช้ได้ — ต้องตรงกับ manual_snapshot() ใน apps/worker/app/tasks/match.py
    const names = [...new Set([entry.nameEnNormalized, entry.nameThNormalized].filter((n): n is string => !!n))].sort();
    const snapshot = { rosterEntryId: entry.id, candidateNo: entry.candidateNo, names, examMode: entry.examMode };
    await save(tx, page, { manualMatch: snapshot, matchedManually: true, rosterEntryId: entry.id });
    return { audit: "PAGE_LINKED_MANUALLY", after: snapshot };
  },

  async DISCARD(tx, _batch, page) {
    requireStatus(page, DISCARDABLE, "หน้านี้ทิ้งไม่ได้ในสถานะนี้");
    await save(tx, page, {
      matchStatus: "DISCARDED",
      review: { ...reviewOf(page), discardedFrom: page.matchStatus } as Prisma.InputJsonValue,
    });
    return { audit: "CERTIFICATE_DISCARDED", after: { status: "DISCARDED" } };
  },

  /** คืนหน้าที่ทิ้งไว้ — หน้าที่เคยติดเรื่องสัญชาติหรือรอบ/ปีกลับไปรอตรวจเหมือนเดิม ไม่ข้ามด่าน */
  async RESTORE(tx, _batch, page) {
    requireStatus(page, ["DISCARDED"], "หน้านี้ไม่ได้ถูกทิ้งไว้");
    const from = reviewOf(page).discardedFrom as MatchStatus | undefined;
    const status: MatchStatus = from === "NATIONALITY_UNVERIFIED" || from === "PARSE_REVIEW" ? from : "UNMATCHED";
    const { discardedFrom: _discarded, ...rest } = reviewOf(page);
    await save(tx, page, { matchStatus: status, review: rest as Prisma.InputJsonValue });
    return { audit: "CERTIFICATE_RESTORED", after: { status } };
  },

  /**
   * เปลี่ยนรางวัลอย่างตั้งใจ — รางวัลตามโฟลเดอร์ยังเก็บไว้เป็นหลักฐาน ไม่ถูกเขียนทับ
   * เลือกได้เฉพาะรางวัลในแคตตาล็อกของรายการ/รอบนี้ และคนนี้ต้องยังไม่มีรางวัลนั้น
   */
  async RECLASSIFY(tx, batch, page, input) {
    requireStatus(page, ["MATCHED", "DUPLICATE_NAME"], "เปลี่ยนรางวัลได้เฉพาะหน้าที่จับคู่แล้วหรือหน้าที่รอตัดสินใบซ้ำ");
    const award = awardCatalog(batch.programCode, batch.round).find((a) => a.code === input.awardCode);
    if (!award) throw new HttpError(400, `รางวัล ${input.awardCode} ไม่มีในรายการสอบ/รอบนี้`);
    const current = page.awardOverride ?? page.award;
    if (award.code === current) throw new HttpError(409, "หน้านี้เป็นรางวัลนี้อยู่แล้ว");
    if (page.rosterEntryId) {
      const clash = await tx.stagingPage.findFirst({
        where: {
          rosterEntryId: page.rosterEntryId,
          id: { not: page.id },
          matchStatus: "MATCHED",
          OR: [{ awardOverride: award.code }, { awardOverride: null, award: award.code }],
        },
      });
      if (clash) throw new HttpError(409, `ผู้เข้าสอบคนนี้มีใบรางวัล ${award.label} อยู่แล้ว`);
    }
    // กลับไปเป็นรางวัลตามโฟลเดอร์ = ล้างการเปลี่ยน ไม่ใช่ซ้อนการเปลี่ยนอีกชั้น
    const override = award.code === page.award ? null : award.code;
    await save(tx, page, { awardOverride: override, awardOverrideAt: override ? new Date() : null });
    return { audit: "AWARD_RECLASSIFIED", after: { folderAward: page.award, award: award.code } };
  },

  /** ใบซ้ำ: ใช้หน้านี้แทนใบที่รับไปแล้ว — ใบเดิมถูกทิ้ง (ยังเก็บไว้เป็นหลักฐาน) */
  async USE_THIS(tx, _batch, page) {
    requireStatus(page, ["DUPLICATE_NAME"], "หน้านี้ไม่ได้รอตัดสินใบซ้ำ");
    const acceptedId = reviewOf(page).acceptedPageId as string | undefined;
    const accepted = acceptedId && (await tx.stagingPage.findUnique({ where: { id: acceptedId } }));
    if (!accepted || accepted.matchStatus !== "MATCHED") {
      throw new HttpError(409, "ใบเดิมเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่");
    }
    await tx.stagingPage.update({
      where: { id: accepted.id },
      data: {
        matchStatus: "DISCARDED",
        matchNote: `แอดมินเลือกใช้หน้า ${page.pageNumber} แทน`,
        review: { ...reviewOf(accepted), discardedFrom: "MATCHED" },
        version: { increment: 1 },
      },
    });
    await save(tx, page, {});
    return { audit: "DUPLICATE_RESOLVED", before: { acceptedPageId: accepted.id }, after: { acceptedPageId: page.id } };
  },
};
