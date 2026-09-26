# Admin Intake Flow: Online and Onsite

Date: 2026-09-23

## Summary

Redesign the admin intake flow so the roster becomes the durable source of expected participants before any certificate ZIP is accepted. A single batch contains both online and onsite participants. Each roster entry records exactly one exam mode, while certificate ZIPs may contain both modes or only one.

The redesign also adds a searchable admin editor, safe incremental certificate uploads, explicit issue resolution, partial publishing, and durable audit records. Exam mode is an admin-only field and is never shown on public search or download pages.

Certificate parsing is selected by exam program and round. Each program owns a Python profile with separate Heat and Final behavior, while a shared declarative manifest supplies the award catalog to both Python and TypeScript. Awards retain the source program's real codes and labels; for example, `1ST_PRIZE` is not collapsed into `GOLD`.

This design intentionally does not migrate or backfill the one existing data set. After implementation, the old data will be backed up, cleared in a separate operation, and re-imported through the new flow.

## Goals

- Require a valid combined roster before accepting certificate files.
- Persist every expected participant, including participants whose certificates have not arrived.
- Record whether each participant is `ONLINE` or `ONSITE`.
- Show roster totals for all participants, online participants, and onsite participants.
- Accept combined, online-only, and onsite-only certificate ZIPs.
- Allow repeated ZIP uploads without replacing already accepted certificates.
- Detect and safely resolve certificate/roster mode mismatches.
- Allow admins to add a missing participant manually and preserve manual entries across later roster replacements.
- Allow admins to search and edit participant and certificate data after withdrawing publication.
- Publish valid participants while holding unresolved participants back.
- Preserve enough source and audit data to explain every manual correction.
- Isolate certificate-layout rules by exam program and round.
- Preserve each program's real award names, including optional special and participation awards.

## Non-goals

- Showing online/onsite mode on public pages.
- Supporting participants who should not receive a certificate. Every active roster entry is expected to have at least one certificate.
- Migrating or backfilling old batches.
- Introducing named admin accounts. The current shared admin authentication cannot identify a human actor reliably; audit events will record the authenticated admin session, timestamp, and change details. Named actors require a separate authentication project.
- Inferring awards from certificate text or the roster. The ZIP award folder remains the primary award source.
- Versioning certificate profiles by year. The first implementation has one Heat and one Final profile per program; historical research will determine whether versioning is necessary later.
- Allowing admins to edit parser regexes, folder rules, or award catalogs. Those changes require code review, tests, and deployment.

## Core invariants

1. A batch represents one exam program, round, and year, and contains both exam modes.
2. Every active roster entry has exactly one mode: `ONLINE` or `ONSITE`.
3. A candidate number is unique across both modes within a batch.
4. One participant may have only one mode within a batch.
5. Every roster entry is expected to have at least one accepted certificate.
6. A participant may have multiple certificates only when their program-specific award codes differ.
7. The normal duplicate key for a certificate is `(batch, candidate number, award)`.
8. Awards come from the ZIP award folder and the selected profile's whitelist. A later admin reclassification is an explicit, audited override and never an inference from page text or Excel.
9. The system never guesses when a name, identity, mode, or duplicate is ambiguous.
10. No upload or edit is allowed while a batch is published. An admin must explicitly withdraw publication first.
11. Large files continue to travel directly between the browser and R2. They never pass through the Next.js server.
12. Every supported `(program code, round)` pair resolves to exactly one profile. Missing profiles fail closed; there is no silent generic fallback.

## Certificate profile architecture

### Module layout

The worker uses one Python module per exam program, with separate Heat and Final profile objects inside that module:

```text
apps/worker/app/certificate_profiles/
├── base.py
├── common.py
├── registry.py
├── hkimo.py
├── timo.py
├── bbb.py
├── hkico.py
└── hkiso.py
```

- `base.py` defines the profile contract, parsed result, policies, and award types.
- `common.py` contains reusable text, anchor, candidate-number, year, school, country, and path helpers.
- Each program module declares one Heat and one Final profile and overrides only behavior that is truly different.
- `registry.py` maps `(program code, round)` to the matching profile object.

For example:

```text
(HKIMO, HEAT)  -> HKIMO_HEAT
(HKIMO, FINAL) -> HKIMO_FINAL
(BBB, HEAT)    -> BBB_HEAT
(BBB, FINAL)   -> BBB_FINAL
```

The registry is a selector, not a parser. `split.py` asks the registry for the profile belonging to its batch and then passes every page to that profile. An unsupported pair is rejected before any source file is processed.

### Profile contract

Every profile declares:

- program code and round
- whether `from` represents a school, a country, or neither
- nationality policy
- folder/path policy
- allowed award catalog
- name, candidate-number, level, round, and year extraction behavior
- optional program-specific metadata extraction

Every profile returns the same conceptual `ParsedCertificate` result:

- name
- candidate number
- level
- `schoolOnPage`
- `countryOnPage`
- round and year found on the page
- award text found on the page for cross-checking
- optional extra metadata
- warnings
- blocking parse errors

The existing `extract.py` becomes orchestration around this contract rather than a home for one global set of environment regexes. Common layouts use shared helpers; genuinely different layouts such as BBB may override focused methods such as name extraction.

### Profile selection and future versioning

The web checks shared profile metadata before allowing an import batch to begin. An exam program may exist administratively without a parser, but an unsupported program/round cannot start intake.

The batch and jobs record a stable `profileKey`, such as `HKIMO_HEAT`, for diagnostics. This release intentionally has no `V1`/`V2` profile selection. Editing a profile and redeploying changes the behavior used by later reprocessing of that profile; this limitation is accepted until historical certificate layouts have been studied.

The profile interface must remain isolated enough that future versioned registry keys can be introduced without changing the split and match pipelines.

## Program-specific award catalogs

Award definitions live in shared declarative manifests readable by both Python and TypeScript:

```text
shared/certificate-profiles/
├── hkimo.json
├── timo.json
├── bbb.json
├── hkico.json
└── hkiso.json
```

Python program modules own page parsing; the shared manifests own display and folder-recognition metadata so the worker and web cannot silently drift.

Each award definition contains:

- stable program-specific code
- original English display label
- optional Thai label
- `PRIMARY` or `SUPPLEMENTAL` kind
- allowed rounds
- exact folder aliases
- display order
- badge presentation key

Programs retain their real award taxonomy. BBB can use `1ST_PRIZE`, `2ND_PRIZE`, and `3RD_PRIZE`; those codes must not normalize to `GOLD`, `SILVER`, and `BRONZE`. The database and public UI preserve the source program's label.

All program catalogs support:

- `SPECIAL_AWARD` as a `SUPPLEMENTAL` award in Heat and Final.
- `PARTICIPATION` as a `PRIMARY` award in Heat only.

These two definitions are allowed even when the current sample set contains no recipient. `PARTICIPATION` in a Final ZIP is invalid. Unknown or misspelled folder awards stop the whole ZIP; the system never creates a new award automatically.

The folder-derived award is authoritative. Award text extracted from the page and the roster award are cross-checks only.

## Data model

### New enums

`ExamMode`

- `ONLINE`
- `ONSITE`

`RosterSource`

- `EXCEL`
- `MANUAL`

### RosterEntry

`RosterEntry` is the durable participant record for one batch. It is separate from `Student` because exam mode, candidate number, level, and roster source belong to a particular sitting, not to a person across all years.

Required fields:

- `id`
- `batchId`
- `candidateNo`
- `nameEn` and/or `nameTh`, with at least one required
- normalized name fields and English name sort key
- `examMode`
- `source`
- created and updated timestamps

Optional fields:

- `school` and normalized school
- `level`
- raw roster award for cross-checking and missing-file guidance
- source Excel row number
- `studentId`, filled only after identity resolution is safe

Constraints and indexes:

- Unique `(batchId, candidateNo)`.
- Index `(batchId, examMode)` for summaries and filters.
- Normalized-name indexes for admin search and fallback matching.
- An active roster entry cannot have a null exam mode.

### Batch profile selection

Each batch stores the selected unversioned `profileKey`. It is derived from program code and round through the supported-profile manifest when the batch is created. Intake APIs revalidate that the matching worker profile exists before queuing work.

### RosterImport and draft rows

A roster replacement must not alter active data until the whole file has passed validation. Store each attempted import as a `RosterImport` and its parsed rows as draft import rows, or an equivalent durable draft representation.

Each Excel upload uses a new versioned R2 key. An invalid draft must never overwrite the source file belonging to the currently active roster import.

The import records:

- R2 source key and upload timestamp.
- Validation state and validation messages.
- total, online, and onsite counts.
- duplicate candidate numbers and invalid source rows.
- conflicts with `MANUAL` roster entries.
- activation timestamp.

Only one roster import is active for a batch. Invalid or unresolved drafts never affect active roster entries.

### StagingPage changes

Add:

- `examMode`, read from the ZIP path for mode/award ZIPs or derived from the matched roster entry for award-only ZIPs; `extra.modeSource` records which.
- nullable `rosterEntryId`.
- a source upload/job identifier so repeated uploads and cleanup are traceable.
- an optional explicit award override while preserving the original folder-derived award.
- `schoolOnPage` and `countryOnPage` as distinct nullable fields.
- program-specific folder award code and a snapshot of its display label.
- parser warnings, blocking errors, and optional extra metadata required for review.

Extend the review states so the UI can distinguish at least:

- `UNMATCHED`
- `MATCHED`
- `NAME_MISMATCH`
- `MODE_MISMATCH`
- `AMBIGUOUS`
- `DUPLICATE_NAME` or an equivalent duplicate-review state
- `DISCARDED`
- existing foreign-page handling where applicable

The original source path and folder-derived award remain immutable evidence. A mode read from the ZIP path remains immutable evidence; an award-only ZIP has no folder mode, so its roster-derived mode is recalculated after roster changes.

### Certificate changes

Each certificate links to its `RosterEntry`. Multiple certificates may link to one roster entry when program-specific award codes differ.

The certificate keeps the effective `awardCode` and display-label snapshot used publicly. If an admin reclassifies an award, the staging page retains both the original folder award and the override, and the audit log records the transition.

The public search model remains based on `Student`; exam mode is not exposed publicly.

### Audit events

Record security-sensitive admin changes, including:

- manual roster entry creation or deletion
- name, candidate number, mode, school, or level changes
- certificate file replacement
- award reclassification
- mode-mismatch confirmation
- certificate discard or restore
- roster conflict resolution
- publication withdrawal and publication

Each event records batch, entity type and ID, action, before/after values, timestamp, and the available authenticated-session identifier. It must not claim a named human actor while shared-password authentication is in use.

## Admin workflow

### 1. Create an unpublished batch

The existing exam program, round, and year selection remains. The web resolves and displays the unversioned profile key for the selected program and round. A batch cannot begin intake if that pair has no supported profile. A new supported batch begins unpublished and has no active roster.

### 2. Upload and activate the roster

The roster is a combined online/onsite Excel file. Every data row must contain:

- candidate number
- at least one supported name field
- exam mode

Exam-mode parsing trims surrounding whitespace and ignores case, but accepts only `ONLINE` and `ONSITE` after normalization.

Validation rejects the entire draft when:

- a required column is missing
- a required value is blank
- an exam-mode value is unknown
- a candidate number occurs more than once anywhere in the file
- a row cannot supply a usable name

The validation result lists every actionable row error rather than stopping at the first one.

When a valid draft does not conflict with manual entries, activation replaces all active `EXCEL` roster entries in one database transaction and preserves non-conflicting `MANUAL` entries.

When an incoming row conflicts with a manual entry, activation pauses for admin review. The admin may:

- merge the incoming row into the manual entry, selecting the intended values; or
- keep the manual entry and exclude the conflicting incoming row.

The candidate-number uniqueness constraint must still hold after all resolutions. Only then may the draft activate.

After activation, the system invalidates automatic matching results, retains source evidence, and queues an idempotent rematch. Because the batch is unpublished, no partially recomputed result can become public.

### 3. Show roster summary

After activation, show:

- total participants
- online participants
- onsite participants
- entries from Excel
- entries added manually
- unresolved draft conflicts, if any

The certificate upload step stays disabled until an active roster exists.

### 4. Upload certificate ZIPs

Supported layouts are:

```text
online/{award}/*.pdf
onsite/{award}/*.pdf
{award}/*.pdf
```

A ZIP uses either mode/award folders or award-only folders, never both layouts together. In the mode/award layout it may contain both roots or only one. Both layouts may have one harmless outer wrapper directory:

```text
HKIMO/online/gold/file.pdf
HKIMO/onsite/silver/file.pdf
```

The profile may declare a deeper structure where it is part of the source format. For example, a profile may accept grade below the award:

```text
online/gold/P3/file.pdf
online/gold/S2/file.pdf
```

Award discovery follows the selected profile's exact path policy. It does not use the immediate parent directory blindly, and it does not search arbitrary ancestors until something resembles an award.

Mac metadata files and other explicitly ignored platform artifacts remain ignored. A PDF may not sit outside the selected hierarchy.

Before splitting any page, the worker performs a full structural preflight. The whole ZIP is rejected without changing active data when:

- no supported PDF exists
- a PDF lacks a recognized award folder
- an award folder is not an exact alias in the selected program/round catalog
- `PARTICIPATION` appears in a Final profile
- the hierarchy is otherwise ambiguous
- mode/award and award-only layouts are mixed in one ZIP

Unknown awards stop the whole job. The system never guesses or silently skips them.

ZIPs are uploaded directly to R2, downloaded by the worker to disk, and processed one contained PDF at a time. The worker must not load the whole ZIP or all contained PDFs into memory.

Preflight reports the selected profile, modes found, file and page counts, award counts, unsupported file types, invalid paths, and unknown awards before split work begins.

For award-only ZIPs (approved 2026-09-26), each page gets its mode from the active roster entry found by its printed candidate number. The source is recorded as `ROSTER` and recalculated if the roster changes. The printed name must agree before automatic matching; missing numbers, unknown numbers, and unreadable or mismatched names remain for admin review. A standalone `ONLINE`/`ONSITE` line or `Exam Mode: ...` line, when present, is checked against the roster. School differences are warnings. Folder-derived awards remain authoritative.

### 5. Match each certificate page

For each eligible page:

1. Parse the page with the batch's registered program/round profile.
2. Apply the profile's nationality policy.
3. Read the certificate/candidate number.
4. Find the active roster entry by candidate number.
5. Verify the certificate name against the roster name.
6. Compare ZIP mode with roster mode when the ZIP provides one; otherwise derive mode from the roster after identifying the entry, and compare any explicit mode printed on the page.
7. Take the program-specific award code from the award folder/catalog.
8. Create or update a certificate only after the checks pass.

Candidate number is the primary key because it is guaranteed unique across online and onsite participants in a batch.

If the number cannot be read in a mode/award ZIP, fallback matching may use normalized name plus the folder mode only when that identifies exactly one roster entry. Multiple possible entries become `AMBIGUOUS`; the system does not choose one. An award-only ZIP has no independent mode for this fallback, so a page without a readable number remains `UNMATCHED` for manual review.

Per-page errors do not stop other valid pages:

- no roster entry or no safe fallback: `UNMATCHED`
- candidate number matches but name does not: `NAME_MISMATCH`
- candidate number and name match but mode differs: `MODE_MISMATCH`
- multiple fallback candidates: `AMBIGUOUS`
- a Final page without enough evidence to verify Thailand: `NATIONALITY_UNVERIFIED`
- page round or year conflicts with the batch: blocking parse review
- an accepted certificate already owns the effective duplicate key: duplicate review or skip, depending on whether the page is byte-for-byte/source-equivalent

Heat profiles accept every participant page and interpret the value after `from` as `schoolOnPage`. The roster/Excel school remains authoritative. A difference between roster school and page school creates a warning but does not block matching when candidate number and name agree. If the roster school is blank, the page value is shown as an admin suggestion and is not copied automatically.

Final profiles interpret the value after `from` as `countryOnPage`. `THAILAND` continues to matching, another country becomes `SKIPPED_FOREIGN`, and a missing or unreadable country becomes `NATIONALITY_UNVERIFIED` rather than being silently discarded or assumed Thai.

### 6. Incremental ZIP uploads and deduplication

An admin may upload ZIPs repeatedly after the roster exists and while the batch is unpublished.

- An already accepted `(candidate number, award)` is skipped.
- Re-uploading the same unresolved page does not create another issue row.
- A new correctly classified page replaces an earlier `MODE_MISMATCH` page for the same candidate and award, and closes the old issue.
- A page for a candidate not yet in the roster remains in staging. Adding that roster entry later triggers rematching.
- A roster entry without an accepted certificate appears in the missing-file queue.

The duplicate implementation must account for unresolved states. The existence of a bad quarantined page must not cause a later correct page to be skipped. The effective duplicate key uses the real program-specific award code; for example, `1ST_PRIZE` remains distinct from `GOLD`.

### 7. Add a missing participant manually

An admin can add a roster entry with:

- unique candidate number
- name
- online/onsite mode
- optional school and level
- optional expected/raw award for follow-up guidance

The entry is marked `MANUAL`. After creation, the system immediately attempts to match compatible staging pages. If none exists, the participant appears in the missing-file queue.

Future Excel replacements preserve manual entries unless the admin explicitly merges or deletes them through conflict resolution.

### 8. Resolve mode mismatch

The review UI shows certificate preview, candidate number, name, roster mode, ZIP mode or mode source, any printed mode, award, source ZIP, and source path.

The admin can:

- **Use roster mode:** allowed only when candidate number and name already match. The system records an audited mode override and completes matching.
- **Discard and wait for a new file:** the page remains as discarded evidence and cannot publish.
- **Upload a corrected ZIP/PDF:** a correctly classified replacement supersedes the quarantined page.

Uploading the same mismatch again updates or recognizes the existing issue; it does not create repeated issue cards.

## Searchable admin editor

The admin editor searches by name or candidate number and filters by:

- exam mode
- award
- issue state
- roster source
- certificate presence

The detail view separates participation data from certificate data.

### Participation edits

Admins may edit name, candidate number, mode, school, and level while the batch is unpublished.

- Candidate-number changes must remain unique and trigger rematching.
- Mode changes revalidate every linked staging page and certificate.
- Name changes recompute normalized fields and revalidate certificate names.
- If the linked `Student` has certificates in other exams, the UI warns how many historical records a global student-name edit affects.
- If records were joined to the wrong person, the admin uses a separate-person action instead of renaming the shared `Student`.

### Certificate edits

Admins may:

- replace a PDF and preview
- add a certificate for the selected participant
- discard or restore a certificate
- explicitly reclassify its award

A replacement PDF must pass candidate-number and name checks before becoming active. A multi-page upload selects only the unique matching page; if selection remains ambiguous, it is rejected with a clear instruction to upload a single-page PDF.

Award reclassification is not a free-text edit. It is an explicit action that:

- requires confirmation
- limits the target to the selected program/round catalog
- checks that the participant does not already have the target program-specific award code
- preserves the folder-derived original award
- records the effective override and audit event

## Publication rules

While a batch is published, both the UI and APIs reject:

- roster uploads
- ZIP/PDF uploads
- roster activation
- participant edits
- certificate edits and issue-resolution actions

The admin must explicitly withdraw the batch first. Withdrawal makes all certificates in that batch temporarily unavailable publicly until the next publish action.

Publishing is participant-aware and may be partial:

- Publish only certificates whose roster entry and staging page are fully matched and valid.
- Hold participants with missing files, `NAME_MISMATCH`, `MODE_MISMATCH`, `AMBIGUOUS`, duplicate review, or other unresolved states.
- Keep the existing multi-award policy checks.
- Show the exact number of participants and certificates to publish and the number held back, grouped by reason and mode.

A later correction requires another explicit withdrawal, edit/upload, review, and publish cycle. Publishing again republishes every currently valid certificate and continues holding invalid entries.

## Failure handling and concurrency

- Permit only one mutating import/edit job per batch at a time.
- Enforce the lock in the API/database path, not only by disabling buttons.
- Use optimistic version checks for interactive edits so two browser tabs cannot silently overwrite each other.
- Perform ZIP structural preflight before deleting or replacing active page data.
- Make roster activation and manual edits transactional.
- Make matching idempotent: a retry first removes only prior automatic results that the job owns, while preserving explicit admin decisions unless the active roster change invalidates them.
- When a roster replacement changes identity inputs, previously manual matches return to review rather than being trusted silently.
- Track R2 keys created by a failed job and clean those derived files on rollback/retry. Keep the uploaded source file for diagnosis until normal source cleanup.
- Return file-validation errors as user errors with row, path, or page context. Reserve system-failure messaging for infrastructure or code failures.

## Data reset and re-import

Backward compatibility is deliberately excluded. After the new flow is deployed and verified:

1. Back up the existing database records and source/derived object inventory.
2. Run the data-removal operation separately from schema migration.
3. Confirm the exact batch and object prefixes before deleting anything.
4. Re-import the sole existing data set using a roster that includes valid online/onsite values and ZIPs in the new hierarchy.
5. Compare roster totals, mode totals, certificate totals, held issues, and a sample of public downloads before publishing.

The implementation plan must treat backup, reset, and re-import as an explicit operational phase requiring confirmation. Schema deployment must not erase production data automatically.

## Test strategy

All tests use synthetic fixtures. Real rosters and certificates must never enter the repository.

### Roster tests

- Missing exam-mode column rejects the whole draft.
- Blank or unknown mode reports every bad row.
- Candidate-number duplication across online and onsite rows rejects the draft.
- Header aliases, whitespace, and case normalization behave as specified.
- A failed draft leaves the active roster unchanged.
- Activation replaces Excel entries atomically.
- Manual entries survive replacement.
- Manual-entry conflicts require resolution and preserve uniqueness.
- Summary totals are correct.

### ZIP and matching tests

- Combined, online-only, onsite-only, and one-wrapper ZIP layouts pass.
- Profile-declared deeper folder layouts pass only for the programs that declare them.
- Missing award, loose PDF, unknown award, and mixed layouts reject the whole ZIP before mutation.
- Award-only ZIPs use roster mode after number and name checks; missing or mismatched evidence remains unresolved.
- `PARTICIPATION` is accepted in Heat and rejected in Final.
- `SPECIAL_AWARD` is accepted as supplemental in both rounds.
- Program-specific labels remain distinct; `1ST_PRIZE` never becomes `GOLD`.
- Candidate number, name, and mode agreement produces `MATCHED`.
- Name mismatch and mode mismatch produce distinct states.
- Heat stores `schoolOnPage`, keeps the roster school authoritative, and reports differences as warnings.
- Final accepts `THAILAND`, skips explicit foreign countries, and sends missing country evidence to `NATIONALITY_UNVERIFIED`.
- Unique name-plus-mode fallback works for mode/award ZIPs when candidate number is unreadable; award-only ZIPs hold those pages for manual review.
- Ambiguous fallback never creates a certificate.
- Multiple awards for one participant work; the same award cannot duplicate.
- Append skips accepted certificates.
- Repeated unresolved uploads do not multiply issues.
- A corrected upload supersedes a mode mismatch.
- Adding a manual roster entry rematches a waiting staging page.
- Missing-file lists include every roster entry with no accepted certificate and separate online/onsite counts.

### Editor and publication tests

- Published batches reject every upload and mutation API.
- Withdrawal enables edits.
- Candidate-number and award uniqueness are enforced during edits.
- Name, mode, award, and file changes create audit events.
- Replacement PDFs must match the intended candidate and name.
- Award reclassification preserves the original award and prevents collisions.
- Partial publish includes only valid entries and reports held reasons accurately.
- Republishing after correction publishes all currently valid entries.

### Resource and cross-language tests

- Large ZIP processing continues to use disk and one-contained-PDF-at-a-time reading.
- Browser uploads continue to use presigned R2 PUTs.
- Any normalization change is implemented in both TypeScript and Python and covered by the shared normalization cases.
- Every supported shared-manifest `(program, round)` pair has exactly one registered Python profile.
- Every profile returns the common parsed-result contract for synthetic Heat and Final fixtures.
- Award aliases are unique within a program/round catalog and are read identically by Python and TypeScript.
- Adding one profile cannot change parser results for another profile.

## Acceptance criteria

The design is complete when an admin can:

1. Import one combined roster and see correct total, online, and onsite counts.
2. Upload any supported ZIP variant repeatedly without replacing accepted certificates.
3. See and resolve distinct name, mode, ambiguity, duplicate, and missing-file issues.
4. Add a participant omitted from Excel and retain that participant across later Excel replacements.
5. Search and safely edit participant and certificate information while unpublished.
6. Publish all valid participants while holding unresolved participants back.
7. Withdraw publication before any subsequent upload or edit.
8. Trace manual corrections to their prior values, new values, time, and authenticated admin session.
9. Select the correct unversioned parser from program and round without a generic fallback.
10. Preserve original program award codes and labels, including special awards and Heat participation.
11. Treat Heat `from` text as a school cross-check and Final `from` text as nationality evidence.
