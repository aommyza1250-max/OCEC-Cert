# Implementation Plan: Admin Intake Flow (Online and Onsite)

Spec: `docs/superpowers/specs/2026-09-23-admin-intake-online-onsite-design.md`
Branch: `feat/admin-intake-online-onsite` (never pushed to `main` without the owner's explicit merge)

## Phases

1. **Profiles and catalogs**
   - `shared/certificate-profiles/*.json` — one manifest per program (award catalog, folder aliases, path policy per round).
   - `apps/worker/app/certificate_profiles/` — `base.py`, `common.py`, `manifest.py`, `registry.py`, one module per program.
   - `apps/web/src/lib/certificate-catalog.ts` — the same manifests for the web.
   - Shared folder-alias cases read by both vitest and pytest.
2. **Schema** — one additive migration. It adds new tables, new nullable columns, and new enum values. It does not delete or rewrite existing rows.
3. **Worker**
   - Jobs: `ROSTER_VALIDATE`, `ROSTER_ACTIVATE`, `SPLIT` (ZIP or single PDF, followed by an inline rematch), and `MATCH`.
   - Structural ZIP preflight runs before any mutation.
   - Deduplication uses fingerprints and supersedes older unresolved pages.
   - Derived files are stored under a per-job R2 prefix, so a failed job can be rolled back.
   - Matching is a pure decision function applied as a diff, with identity resolution that never guesses.
4. **Web**
   - Guarded mutations: batch row lock, publication lock, legacy lock, and optimistic versions.
   - Audit events carry an opaque session id.
   - Roster, certificate, issue-resolution, editor, and publish routes.
   - Admin UI (Thai) for the whole flow.
5. **Scripts and docs** — e2e demo, real-file checker, roster generator, admin guide, intake spec, DB doc, and a runbook for backup, reset, and re-import.
6. **Verification** — pytest (unit plus test-DB integration), vitest, typecheck, `next build`, e2e demo, real-file check, and Docker builds.

## Interpretations and decisions

| Topic | Decision | Why |
|---|---|---|
| BBB award codes | `1ST_PRIZE`/`2ND_PRIZE`/`3RD_PRIZE`. The BBB Heat folders `Gold`/`Silver`/`Bronze` are listed as exact aliases of those codes. | The real BBB Heat ZIP uses `Gold/` folders, but every page in them prints "1st Prize Award". The code keeps BBB's real label, and the alias only recognizes the source layout. |
| Supplemental awards | The hold rule and the `MEDAL_ONLY` policy apply to every `SUPPLEMENTAL` award, not only `PERFECT_SCORE`. | The spec introduced PRIMARY/SUPPLEMENTAL kinds and asked to keep the existing multi-award checks. Holding is the safe direction. The rule is one function (`decidePublish`). |
| Roster activation | Validation is automatic. Activation is always an explicit admin click, and it runs as a worker job in one transaction. | The admin sees the total/online/onsite counts before active data changes. Heavy roster logic stays in one language (Python). |
| Manual-entry conflicts | Detected by the worker (same candidate number, or same normalized name with a different number). They are rechecked at activation. Merging turns the manual entry into an Excel entry. | Spec §2: "preserve manual entries unless the admin explicitly merges or deletes them". |
| Replace-whole-batch ZIP mode | Removed. Replaced with "discard every page from this upload" (audited). | Replacing everything destroys manual decisions and audit evidence. A wrong ZIP still needs a bulk undo. |
| Award for a single-PDF upload | The admin must choose it from the round's catalog. It is never inferred. | Invariant 8. Page text is only used to pick the page when one number appears on several pages. |
| Fallback matching | Uses normalized name plus mode only when the page number is unreadable. A readable number that is not in the roster becomes `UNMATCHED`. | Spec §5. |
| Identity (`Student`) | Never links two roster entries of one batch to the same student. If several same-name entries compete for one historical student, the result is `AMBIGUOUS`. | CLAUDE.md rule 4. |
| Legacy batches (created before this change) | Stay public as they are. New-flow intake is blocked. Withdrawal is allowed with a warning. Republishing needs a re-import. | The spec excludes migration and backfill. |
| Session id for audit | The cookie gains a random session id (the admin must log in again once after deploy). Audit stores that id, never the cookie. | The spec asks for the authenticated-session identifier without claiming a named actor. |
| Image files (JPG) | Not accepted. Reported as unsupported in preflight. | The spec is PDF-only. Real sources are PDF. |

## Out of scope (operational phase — needs explicit confirmation)

Backup, reset, and re-import of the existing data set. Code support ships as `scripts/backup_batch.py` (read-only), plus a runbook section. Deletion keeps using the existing typed-confirmation delete flow. Nothing in this branch deletes production data.
