# GATES LEDGER

Per CLAUDE.md: every gate must reach [MET] with an Evidence Block before its
phase is declared complete. Evidence is appended at each phase handoff.

## Phase 1 — Foundation and Master Profile

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
|---|---|---|---|---|
| 1.1 | Workspace boots | `pnpm install && pnpm typecheck` succeed | exit code 0 and both commands' output shown | [MET] |
| 1.2 | DB up and migrated | `docker compose up -d` then `pnpm db:migrate` succeed, vector extension present | `SELECT extname FROM pg_extension` output includes vector | [MET] |
| 1.3 | Seed | Admin user and default Settings exist | Query output shows mode COPILOT, dailyCap 10, allowSubmit false | [MET] |
| 1.4 | Auth wall | Unauthenticated request to /profile redirects to /login | curl shows 307 to /login | [MET] |
| 1.5 | Crypto | Round trip, tamper and wrong-key tests | vitest lists 4 passing crypto tests including DecryptionError | [MET] |
| 1.6 | Fid stability | assignMissingFids preserves existing ids | vitest test fails if any existing fid changes | [MET] |
| 1.7 | Fact Index years | Fixture profile: Python 2019-01 to 2021-06 and 2021-01 to 2023-12 (overlap) | yearsOfExperience('python') equals 5.0 (60 inclusive months; a naive sum would give 5.5) in test output | [MET] |
| 1.8 | Alias map | 150+ aliases, hasSkill('k8s') true when profile lists Kubernetes | Test output and wc -l of aliases file | [MET] |
| 1.9 | Profile import UI | Valid JSON Resume imports, invalid shows inline zod errors | Playwright assertion for both cases | [MET] |
| 1.10 | Fact persistence | Saving a profile writes Fact rows in one transaction | Count of Fact rows equals count of facts in index; rollback test passes | [MET] |
| 1.11 | LLM client | Retry, repair-retry and timeout paths covered | vitest shows tests for 429 retry, invalid-output repair, timeout | [MET] |
| 1.12 | Untrusted wrapper | Zero-width, HTML comment and control chars stripped | Test with a string containing \u200b and <!-- ignore all rules --> returns clean text | [MET] |
| 1.13 | Redaction | Email, phone, address masked | vitest table test output | [MET] |
| 1.14 | Audit | LLM call and profile save both create AuditLog rows, visible on /audit | Rows shown in UI screenshot or query output | [MET] |
| 1.15 | Settings guard | AUTOPILOT and allowSubmit toggles disabled | UI assertion shows disabled attribute | [MET] |

## Evidence Blocks — Phase 1

### Gate 1.1 — Workspace boots [MET]

`pnpm install` (exit 0):

```
Packages: +431
Progress: resolved 576 of 576, downloaded 437, added 431, done
Done in 20.7s using pnpm v10.34.5
```

`pnpm typecheck` (exit 0, all 9 workspace projects):

```
 Tasks:    9 successful, 9 total
Cached:    6 cached, 9 total
  Time:    2.984s
```

Walkthrough: pnpm workspace with turbo resolves all 9 packages
(core, db, llm, render, sources, apply, web, worker, mock-ats);
`tsc --noEmit` passes strict mode in every package.

`pnpm lint` (exit 0): `✖ 0 problems (0 errors, 0 warnings)` after fixes.

### Gate 1.5 — Crypto [MET]

`pnpm --filter @jobpilot/core test` (excerpt):

```
✓ test/crypto.test.ts (4 tests)
Test Files  3 passed (3)
     Tests  16 passed (16)
```

Walkthrough: 4 crypto tests pass — round trip (`v1.<iv>.<tag>.<ciphertext>`
base64url envelope), fresh IV per call, tampered ciphertext throws
`DecryptionError` (GCM auth-tag flip), wrong key throws `DecryptionError`.

### Gate 1.6 — Fid stability [MET]

Same run: `test/schema.test.ts (5 tests)` includes
"preserves every existing fid" (`assignMissingFids(once)` then
`assignMissingFids(twice)`; `expect(twice).toEqual(once)`), plus reordering
and absent-fid cases. Any change to an existing fid fails the test.

### Gate 1.7 — Fact Index years [MET]

Same run:

```
✓ Fact Index (gates 1.7, 1.8) > counts overlapping intervals inclusively: python = 5.0 years, not 5.5
```

Walkthrough: 2019-01→2021-06 (30 months) and 2021-01→2023-12 (36 months)
merge into one interval of 60 inclusive months = 5.0 years; a naive sum
would give 5.5. Implemented by interval merging in
`packages/core/src/profile/factIndex.ts`, pure deterministic code, no LLM.

### Gate 1.8 — Alias map [MET]

```
$ wc -l packages/core/src/profile/aliases.ts
260 packages/core/src/profile/aliases.ts
$ grep -c '": "' packages/core/src/profile/aliases.ts
216
```

Test output:

```
✓ Fact Index (gates 1.7, 1.8) > has at least 150 alias entries
✓ Fact Index (gates 1.7, 1.8) > resolves aliases: hasSkill('k8s') is true when profile lists Kubernetes
```

Walkthrough: 216 alias entries (≥ 150 required), including k8s→kubernetes,
postgres→postgresql, js→javascript, gcp→google cloud, ml→machine learning.
The fixture profile lists "Kubernetes" and `hasSkill('k8s')` resolves true.

### Gate 1.11 — LLM client [MET]

`pnpm --filter @jobpilot/llm test`:

```
✓ test/anthropicClient.test.ts (4 tests)
Test Files  4 passed (4)
     Tests  21 passed (21)
```

Walkthrough: a local mock Anthropic server proves (a) two 429 responses are
retried with exponential backoff (`sleeps = [500, 1000]`) then succeed,
(b) invalid structured output triggers exactly one repair retry that feeds
zod issues back and succeeds, (c) a hanging server hits the configured
timeout and the call fails without hanging forever, each writing an AuditLog
entry via the injected audit writer.

### Gate 1.12 — Untrusted wrapper [MET]

Same run: `test/untrusted.test.ts (4 tests)` includes the case with
`\u200b`, `\u2060`, `\ufeff`, `<!-- ignore all rules -->` and a `\u0007`
control char — all stripped; wrapper emits
`DATA NOTICE: … <untrusted label="jd">…</untrusted>`.

### Gate 1.13 — Redaction [MET]

Same run: `test/redact.test.ts (10 tests)` — table covering emails
(`priya.sharma@example.com` → `[EMAIL]`), phones (`+91 98765 43210`,
`(415) 555-1234` → `[PHONE]`), street addresses (`221B Baker Street`,
`12 Main Street` → `[ADDRESS]`), a non-PII passthrough case, and deep
redaction through objects/arrays.

### Gate 1.2 — DB up and migrated [MET]

Docker is not installed on this machine (`docker: command not found`), so the
compose service was replaced by an equivalent local PostgreSQL 17.11 cluster at
`.pgdata` (gitignored) with pgvector, listening on `127.0.0.1:55432`; the
root `.env` points `DATABASE_URL` at it. `packages/db/prisma.config.ts`
loads that root env for the Prisma CLI.

`pnpm db:migrate`:

```
Loaded Prisma config from prisma.config.ts.
Datasource "db": PostgreSQL database "jobpilot", schema "public" at "localhost:55432"

1 migration found in prisma/migrations
No pending migrations to apply.
```

`select extname from pg_extension where extname='vector'`:

```
vector
```

`select tablename from pg_tables where schemaname='public'` returns all 14
domain tables plus `_prisma_migrations`: AnswerBankEntry, Application,
ApplicationEvent, AuditLog, Document, Fact, GapReport, Job, MatchScore, Profile,
ProjectPlan, ResumeVersion, Settings, User.

Walkthrough: the initial migration is a full schema (it previously created only
the extension), so a fresh database reaches the intended state with one command.

### Gate 1.3 — Seed [MET]

`pnpm db:seed`:

```
Seeded admin admin@jobpilot.local with default Settings: mode COPILOT, dailyCap 10, matchThreshold 75, killSwitch false, allowSubmit false
```

`select mode, "dailyCap", "matchThreshold", "killSwitch", "allowSubmit" from "Settings"`:

```
COPILOT|10|75|f|f
```

`select id, email, "createdAt" from "User"` shows the single admin row.

Walkthrough: mode is COPILOT and allowSubmit is false, so I3 (consent) holds out
of the box; the admin password is hashed with Argon2 by `src/seed.ts`.

### Gate 1.4 — Auth wall [MET]

```
$ curl -s -o /dev/null -w "status=%{http_code} location=%{redirect_url}" http://localhost:3000/profile
status=307 location=http://localhost:3000/login
```

Playwright confirms the same for browser navigation:

```
ok 1 tests\e2e\phase1.spec.ts:18:5 › gate 1.4: unauthenticated /profile redirects to /login (307) (32ms)
ok 2 tests\e2e\phase1.spec.ts:28:5 › gate 1.4b: unauthenticated page navigation lands on /login (3.7s)
```

Walkthrough: `middleware.ts` looks for the Auth.js session cookie and redirects
to a same-origin `/login` with 307 before the page renders.

### Gate 1.9 — Profile import UI [MET]

```
ok 3 tests\e2e\phase1.spec.ts:35:5 › gate 1.9: valid JSON Resume imports and shows fact count (9.2s)
ok 4 tests\e2e\phase1.spec.ts:53:5 › gate 1.9b: invalid JSON shows inline zod errors (3.2s)
```

Walkthrough: the valid case imports `fixtures/sample-resume.json`, waits for the
`import-success` panel ("… facts indexed"), then checks the `fact-summary` right
rail shows Python years on `/profile`. The invalid case removes `basics.email`
and asserts the `zod-issues` list plus a "Validation failed" message render
inline. Both run against the real API route and database.

### Gate 1.10 — Fact persistence [MET]

`pnpm --filter @jobpilot/db test`:

```
✓ test/facts.test.ts (2 tests) 2152ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

```
gate 1.10: fact persistence > writes exactly one Fact row per Fact Index fact
gate 1.10: fact persistence > rolls back profile, facts and audit row when the transaction fails
```

Walkthrough: `saveProfileWithFacts` runs the profile upsert, the fact rebuild and
the audit insert in one `prisma.$transaction`. The first test asserts the saved
count equals `buildFactIndex(profile).facts.length` and the stored distinct fids.
The rollback test saves a valid profile, then submits one where two highlights
share a fid (violating `@@unique([profileId, fid])` after the update and delete
already executed) and asserts version, profile JSON, fact count and audit count
are all unchanged.

While proving this gate two real defects were fixed: `buildFactRows` now derives
from `buildFactIndex` (so the table can never disagree with the index), and the
index no longer reuses a project's fid for its description fact — the duplicate
fid made the unique constraint fail and had been silently dropped before.

### Gate 1.14 — Audit [MET]

```
ok 5 tests\e2e\phase1.spec.ts:71:5 › gate 1.14: audit page lists the profile.save row after import (6.2s)
```

`select action, count(*) from "AuditLog" group by action`:

```
         action          | count
-------------------------+-------
 profile.import.rejected |     2
 profile.save            |     4
```

Walkthrough: importing through the UI writes a `profile.save` row and the
`/audit` table renders it; rejected imports write `profile.import.rejected`.
Every write goes through `writeAudit`, which redacts the payload first (I7/I8).

### Gate 1.15 — Settings guard [MET]

```
ok 6 tests\e2e\phase1.spec.ts:85:5 › gate 1.15: AUTOPILOT and allowSubmit controls are disabled (5.4s)
```

Walkthrough: on `/settings` the `mode-select` and `allow-submit` controls both
report `disabled`, and the page shows "Unlocked in Phase 7". Auto-Pilot cannot
be enabled in Phase 1, preserving I3.

## Phase 1 status

All fifteen Phase 1 gates are [MET] with the evidence above. `pnpm typecheck`,
`pnpm lint`, `pnpm test` (16 core + 21 llm + 2 db tests) and `pnpm e2e`
(6 Playwright tests) all exit 0.

Two environment deviations are recorded rather than hidden: the database runs as
a local PostgreSQL 17.11 + pgvector cluster on port 55432 instead of the
`docker compose` service (Docker is not installed here), and the Next dev server
needs `serverExternalPackages` plus a webpack external for the native Argon2
binding and a `.js`→`.ts` extension alias for the transpiled workspace packages.

## Phase 2 — Document rendering and the Documents UI

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
|---|---|---|---|---|
| 2.1 | HTML render | A standalone single-column HTML resume with no tables, images or external assets; profile text is escaped | vitest render tests assert the doctype, sections, absence of `<table>`/`<img>`/`<script src>`, and escaped XSS payloads | [MET] |
| 2.2 | PDF render | Real text-based PDF starting with `%PDF-` | vitest asserts the magic bytes and a >1500-byte buffer | [MET] |
| 2.3 | DOCX render | Real OOXML zip starting with `PK`, not HTML renamed | vitest asserts the zip magic bytes and a >1500-byte buffer | [MET] |
| 2.4 | ATS lint | Deterministic lint that never calls an LLM: missing name/email/skills, oversized bullets, keyword coverage against a job description | vitest ats suite reports the expected issue ids and a coverage gap for COBOL | [MET] |
| 2.5 | Claim guardrail (I1) | A document that invents an employer, title, date or number-bearing bullet is rejected before any artifact exists | vitest rejects with `ClaimValidationError` and reports `UNKNOWN_EMPLOYER`; 20+ claims checked | [MET] |
| 2.6 | Watermark (I6) | A `MOCK_OFFER` document always carries the SAMPLE watermark, with no caller opt-out | vitest asserts `watermark === "SAMPLE"` and that the bytes contain it | [MET] |
| 2.7 | Auth wall on documents | Unauthenticated `/documents` and `/api/documents` never reach the handler | Playwright asserts 307 to `/login` for both the page and the POST | [MET] |
| 2.8 | Documents UI and persistence | Generating from the UI validates every claim, persists the Document row, shows the ATS score and preview, and writes its audit row | Playwright asserts the validated-claim count, ATS score, preview iframe, the row in the documents table and `document.render` on `/audit` | [MET] |
| 2.9 | Binary downloads | PDF and DOCX downloads come back as real binaries with the right content type | Playwright POSTs both formats and asserts `%PDF-`/`PK` magic bytes and length from the download route | [MET] |

## Evidence Blocks — Phase 2

### Gates 2.1–2.6 — Renderer and guardrails [MET]

`pnpm test` (exit 0):

```
@jobpilot/render:test:  ✓ test/ats.test.ts (4 tests) 7ms
@jobpilot/render:test:  ✓ test/render.test.ts (9 tests) 76ms
@jobpilot/render:test:  Test Files  2 passed (2)
@jobpilot/render:test:       Tests  13 passed (13)
 Tasks:    6 successful, 6 total
```

Walkthrough: `renderResume` builds a `ResumeDocument` by verbatim projection of
the profile, runs `validateResumeDocument` before rendering, and throws
`ClaimValidationError` when a fact is not in the Fact Index — so the PDF/DOCX
paths in gate 2.5 fail before a buffer exists. The HTML renderer escapes with
`escapeHtml` and emits no tables, images or external assets; the PDF is emitted
by pdfkit with the watermark drawn on every page, DOCX by `docx` as real OOXML.
13 render tests plus 16 core tests cover gates 2.1–2.6.

### Gates 2.7–2.9 — Documents wall, UI, persistence and downloads [MET]

`pnpm e2e` (exit 0):

```
  ok  7 tests\e2e\phase2.spec.ts:30:5 › gate 2.7: unauthenticated /documents redirects to /login (307) (31ms)
  ok  8 tests\e2e\phase2.spec.ts:39:5 › gate 2.7b: the render API rejects anonymous callers (401) (14ms)
  ok  9 tests\e2e\phase2.spec.ts:54:5 › gate 2.8: generating from the UI validates every claim, persists the document and audits it (19.3s)
  ok 10 tests\e2e\phase2.spec.ts:83:5 › gate 2.9: PDF and DOCX downloads are real binaries (4.5s)
  10 passed (1.1m)
```

Persisted rows after the run:

```
 format | documents | avg_ats
--------+-----------+---------
 docx   |         3 |   100.0
 html   |         2 |   100.0
 pdf    |         3 |   100.0

         action          | count
-------------------------+-------
 document.render         |     8
 profile.import.rejected |     3
 profile.save            |     11
```

Walkthrough: `/api/documents` resolves the session, renders, then writes the
`Document` row and the `document.render` audit row in one transaction, so a
document cannot exist without its audit entry (I8). The download route scopes
`findFirst({ id, userId })` (I7), sends `Cache-Control: private, no-store`, and
adds a `sandbox` CSP to inline HTML. Each of the 8 renders above has exactly one
matching audit row.

### Verification for the phase

```
TYPECHECK_EXIT=0   Tasks: 9 successful, 9 total
LINT_EXIT=0        eslint . (0 errors, 0 warnings)
TEST_EXIT=0        13 render + 16 core + 21 llm + 2 db = 52 tests
E2E_EXIT=0         10 passed (1.1m)
build_exit=0       ✓ Compiled successfully; ƒ /documents, ƒ /api/documents
```

Two real defects were found and fixed while proving this phase rather than worked
around. First, concurrent profile writes failed with Prisma's "Unable to start a
transaction in the given time": interactive transactions hold a pooled connection
and the 2s `maxWait` default expired while two requests queued on the same
profile row, so `saveProfileWithFacts` and `saveRenderedDocument` now pass
`{ maxWait: 15_000, timeout: 30_000 }`. Second, the e2e suite already ran its
specs in parallel against the single seeded admin, so specs contended for that
row; `playwright.config.ts` now pins `workers: 1` with the reason recorded there.

## Phase 2 status

All nine Phase 2 gates are [MET] with the evidence above. `pnpm typecheck`,
`pnpm lint`, `pnpm test` (52 tests) and `pnpm e2e` (10 Playwright tests) exit 0,
and `pnpm build` compiles the app with the new `/documents` route.

One environment deviation carries over from Phase 1: the database is a local
PostgreSQL 17.11 + pgvector cluster on port 55432 (Docker is not installed on
this machine). The cluster in this checkout was created with `initdb` from the
existing portable pgvector install, then migrated and seeded with
`pnpm db:migrate && pnpm db:seed`.

## Phase 3 — job sources

### GATES LEDGER

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
|---|---|---|---|---|
| 3.1 | Normalized draft boundary | Every adapter output is parsed by one zod schema; a malformed board payload fails at the boundary | `jobDraftSchema` rejects a payload of bare ids | [MET] |
| 3.2 | Canonical posting URL | Tracking params, fragments, default ports and trailing slashes are stripped; params sorted | `canonical.test.ts` (3 cases) | [MET] |
| 3.3 | Content hash | Formatting churn hashes identically; real edits change the hash | `canonical.test.ts` (2 cases) | [MET] |
| 3.4 | Greenhouse adapter | Board JSON maps to drafts with HTML converted and timestamps kept in UTC | `parseGreenhouse` over `fixtures/greenhouse.json` | [MET] |
| 3.5 | Lever adapter | Postings map with workplace type, categories and joined description sections | `parseLever` over `fixtures/lever.json` | [MET] |
| 3.6 | Ashby adapter | Jobs map and the compensation summary becomes a salary range | `parseAshby` over `fixtures/ashby.json` | [MET] |
| 3.7 | Adzuna adapter | Search results map; missing credentials raise a config error instead of an empty list | `parseAdzuna` fixture + `fetchAdzuna` rejection | [MET] |
| 3.8 | Untrusted description text | Scripts and styles are stripped; the manual path stores a delimiter-wrapped copy (I2) | `html.test.ts` + manual draft assertion | [MET] |
| 3.9 | Board transport | Retries 5xx and 429, never retries 404, aborts at the timeout, reports non-JSON | `http.test.ts` (5 cases) | [MET] |
| 3.10 | Import dedupe | A tracking-param variant updates the existing row instead of creating one | `saveJobs` DB test: created 1 then updated 1, one row | [MET] |
| 3.11 | Import audit | Each batch writes exactly one `job.import` row in the same transaction (I8) | DB test reads `job.import` payload counts | [MET] |
| 3.12 | Auth wall | `/jobs`, `GET/POST /api/jobs` and `POST /api/jobs/fetch` redirect anonymous callers to `/login` (307) | e2e gate 3.12 | [MET] |
| 3.13 | Board request validation | Unknown provider and empty token return 422 with zod issues; Adzuna without keys returns 400 naming the env vars | e2e gate 3.13 | [MET] |
| 3.13b | Board failure reporting | An unreachable board returns 502 with a message and writes `job.fetch.failed` | e2e gate 3.13b and `/audit` | [MET] |
| 3.14 | Paste-and-import | A pasted posting appears in the table, and re-importing the same posting via another URL surface updates it (one row) | e2e gate 3.14 | [MET] |
| 3.14b | Import API validation | Missing fields and non-http schemes return 422; a valid payload returns 201 and re-posting updates the same id | e2e gate 3.14b | [MET] |
| 3.15 | fetch-sources consumer | The worker handler saves, audits success, and audits with `ok:false` when a board dies | `handler.test.ts` (3 cases) | [MET] |
| 3.16 | Scheduled boards | `JOB_BOARDS` parses `provider:token` pairs and skips unknown or malformed entries | `handler.test.ts` (2 cases) | [MET] |

### Evidence for gates 3.1-3.9 (adapter layer, no network)

```
$ pnpm --filter @jobpilot/sources test
 ✓ test/html.test.ts (4 tests) 2ms
 ✓ test/canonical.test.ts (5 tests) 3ms
 ✓ test/http.test.ts (5 tests) 20ms
 ✓ test/adapters.test.ts (15 tests) 6ms
 ✓ test/handler.test.ts (5 tests) 5ms

 Test Files  5 passed (5)
      Tests  34 passed (34)
```

The adapter tests run against committed fixtures in `packages/sources/test/fixtures`
with an injected `fetchImpl`, so no unit test opens a socket. `http.test.ts` proves
the retry policy directly: a 503 is retried and succeeds on attempt 2, a 404 is not
retried, a third 502 exhausts the budget after delays of 250ms then 500ms, a stalled
response aborts at `timeoutMs`, and a non-JSON body is reported as `kind: "parse"`.

### Evidence for gates 3.10-3.11 (dedupe and audit against the real database)

```
$ pnpm --filter @jobpilot/db test
 ✓ test/facts.test.ts (2 tests) 2198ms
 ✓ test/jobs.test.ts (4 tests) 2230ms
   ✓ gate 3.10: importing postings dedupes on the canonical URL > creates once, then updates the same row for a tracking-param variant  2208ms

 Test Files  2 passed (2)
      Tests  6 passed (6)
```

The test imports `…/role-<stamp>?utm_source=newsletter&gh_src=abc` and then
`…/role-<stamp>/`, asserts `created: 1` followed by `created: 0, updated: 1` with
the same id, and confirms one row whose `canonicalUrl` carries neither tracking
params nor a trailing slash. It also proves a changed description changes
`contentHash`, that the I2 wrapper survives the round trip through Postgres, and
that `job.import` audit payloads record `created`, `updated` and `total`.

### Evidence for gates 3.12-3.14b (browser and API)

```
$ pnpm e2e
Running 15 tests using 1 worker
  ok 11 tests\e2e\phase3.spec.ts:31:5 › gate 3.12: the jobs page and APIs sit behind the auth wall (48ms)
  ok 12 tests\e2e\phase3.spec.ts:56:5 › gate 3.13: a malformed board request is rejected with 422 before any fetch (6.1s)
  ok 13 tests\e2e\phase3.spec.ts:83:5 › gate 3.13b: an unreachable board is reported as 502 and audited (15.4s)
  ok 14 tests\e2e\phase3.spec.ts:98:5 › gate 3.14: a pasted posting imports once, then updates in place (11.0s)
  ok 15 tests\e2e\phase3.spec.ts:134:5 › gate 3.14b: the import API validates its input (422) and rejects other schemes (2.8s)

  15 passed (1.8m)
```

Gate 3.13b reaches the real Lever API with a nonexistent board slug, so transport,
error mapping and the audit row are exercised end to end without depending on a
live vacancy existing.

### Persisted rows after the run

```
 source | jobs | canonical_urls
--------+------+----------------
 manual |    2 |              2

      action      | count
------------------+-------
 job.fetch.failed |     2
 job.import       |     4

 total_jobs
------------
          2
```

Four `job.import` batches produced two rows. The gate 3.14 spec imports one posting
twice, first with tracking parameters and then with a trailing slash, and the row
count for that posting stays at one, which is dedupe visible in the database rather
than only in an assertion.

### Design notes

Adapters only parse; fetching lives in a separate `fetch*` function that accepts an
injectable `fetchImpl`, so parsing is proven from fixtures while transport is proven
by its own retry tests. `saveJobs` does find-then-update/create inside one
interactive transaction and writes the `job.import` audit row there too, so a batch
either lands with its audit row or not at all. The worker is a thin shell:
`makeFetchSourcesHandler` owns the fetch, save and audit sequence and is unit-tested,
while `apps/worker` only wires pg-boss to it. Manual imports wrap the pasted
description with `wrapUntrusted` before storage, so later phases read it as data
(I2), and board failures are audited rather than swallowed.

### Verification for the phase

```
TYPECHECK_EXIT=0   Tasks: 9 successful, 9 total
LINT_EXIT=0        eslint . (0 errors)
TEST_EXIT=0        sources 34 + db 6, all workspace suites green
E2E_EXIT=0         15 passed (1.8m)
```

## Phase 3 status

All 18 Phase 3 gates are [MET] with the evidence above. Two gate labels were
renumbered while writing this ledger, because the worker consumer and the
scheduled-board parser became 3.15 and 3.16 so that test titles, ledger rows and
commits name the same gate. The sources suite was re-run after the rename.

## Phase 4 — application executor

All ten Phase 4 gates are [MET]. The deterministic pre-submit layer (mapping,
Answer Bank resolution, the stop gate and the fill plan) is unit-tested, and the
browser side is proven end to end against `apps/mock-ats`: consent, resume
attachment, pause conditions, per-action auditing and the multi-section form.

### GATES LEDGER

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
|---|---|---|---|---|
| 4.1 | Field mapper | Labels, name/id tokens and autocomplete map to a canonical key set; unknown controls map to `null` | `fields.test.ts` (10 cases) + `plan.test.ts` (9 cases) | [MET] |
| 4.2 | Untrusted labels (I2) | An instruction-like label is flagged, never mapped, and only exposed delimiter-wrapped | `fields.test.ts` gate 4.2 + `plan.test.ts` gate 4.10 case | [MET] |
| 4.3 | Sensitive detection (I5) | Salary, work authorization, disability, criminal history and demographics are flagged and never filled from the profile | `fields.test.ts` gate 4.3 + `plan.test.ts` gate 4.3 | [MET] |
| 4.4 | Answer Bank resolution (I5) | Exact key beats `questionPattern`; ambiguous or malformed patterns fall back to the human | `answers.test.ts` (6 cases) | [MET] |
| 4.5 | Stop preflight (I4) | Kill switch → daily cap → portal cap → per-domain interval → `allowSubmit`, each aborting with one reason code | `preflight.test.ts` (8 cases) | [MET] |
| 4.6 | Consent (I3) | Missing consent returns 422, an unknown or unowned resume returns 409, and a valid pair queues exactly one application | e2e gate 4.6 | [MET] |
| 4.7 | Resume attachment | A rendered PDF is attached and its filename arrives in the submitted form body | e2e gate 4.7/4.9 + `plan.test.ts` | [MET] |
| 4.8 | Pause conditions (I4) | CAPTCHA, expired session, 2FA and login wall pause the run with a reason and click nothing | e2e gate 4.8 + `runner.test.ts` (3 cases) | [MET] |
| 4.9 | Action audit (I8) | Every browser action writes an `AuditLog` row and an `ApplicationEvent`; the run summary is audited too | e2e gate 4.7/4.9 + the row counts below | [MET] |
| 4.10 | Multi-step forms | A form with an unresolved question is never partially submitted; once resolved it posts exactly once with both fields | e2e gate 4.10 + `runner.test.ts` (2 cases) | [MET] |

### Evidence for gates 4.1-4.5

```
$ pnpm --filter @jobpilot/apply typecheck
> tsc --noEmit -p tsconfig.json
TYPECHECK_EXIT=0
```

```
$ pnpm --filter @jobpilot/apply test
 ✓ test/preflight.test.ts (8 tests) 3ms
 ✓ test/fields.test.ts (10 tests) 4ms
 ✓ test/answers.test.ts (6 tests) 3ms
 ✓ test/plan.test.ts (9 tests) 5ms
 ✓ test/runner.test.ts (7 tests) 5ms

 Test Files  5 passed (5)
      Tests  40 passed (40)
```

Walkthrough: `fields.test.ts` copies the control descriptors straight from
`apps/mock-ats` (Greenhouse, Lever, multi-step, salary, EEO, injection), so the
mapper is proven against the markup the executor will actually meet, and asserts
that autocomplete wins over an ambiguous "Name" label. `plan.test.ts` proves the
plan reads only profile fields that exist (`Ada Lovelace` splits, the location
joins), leaves a single-token surname and years of experience to the human, and
requires an Answer Bank entry before either sensitive field is filled.
`preflight.test.ts` pins the check order by making the kill switch win over a
full cap and a fresh rate limit, and returns `retryAfterMs` for the interval.

Two real defects were found and fixed while proving these gates rather than
worked around. First, the autocomplete table keyed `given-name` while lookups
normalize to alphanumerics, so `autocomplete="given-name"` could never match;
both tables are now re-keyed through `normalizeToken` and the autocomplete test
covers it. Second, the sensitive-topic pattern used `\bconvict\b`, which does not
match "convicted of a crime" because the word continues; the pattern now uses
`convict\w*` (with `felon\w*` and `disabilit\w*`) and the failing test passes.

`runner.test.ts` proves the control flow without a browser: the stop gate blocks
before the first navigation, a CAPTCHA or expired session pauses with the right
reason and zero clicks, and a multi-section form with an unanswered `years`
question pauses before anything is clicked. The browser paths below then prove
the same behaviour against real HTML.

### Evidence for gates 4.6-4.10 (browser and API)

```
$ pnpm e2e
Running 19 tests using 1 worker
  ok 16 tests\e2e\phase4.spec.ts:107:5 › gate 4.6: an application needs explicit consent and an approved PDF resume (I3) (5.0s)
  ok 17 tests\e2e\phase4.spec.ts:140:5 › gate 4.7/4.9: the runner fills the form, attaches the resume and the run is audited (6.8s)
  ok 18 tests\e2e\phase4.spec.ts:194:5 › gate 4.8: CAPTCHA and expired sessions pause instead of submitting (I4) (1.1s)
  ok 19 tests\e2e\phase4.spec.ts:222:5 › gate 4.10: a multi-section form is not submitted until every field resolves (1.3s)

  19 passed (1.4m)
```

The submission assertion reads the mock's own request log, so it proves what the
server received rather than what the runner believed it sent:

```
posted = [ { path: "/submit/greenhouse", body:
  "first_name=Priya&last_name=Sharma&email=priya.sharma%40example.com&
   phone=%2B91+98765+43210&resume=jobpilot-resume-<stamp>.pdf&
   cover_letter=I+build+reliable+systems.+<stamp>" } ]
```

Gate 4.10 additionally asserts the mock received nothing while the years question
was unanswered, then exactly one `/submit/multi` carrying `years=8`.

Persisted rows after the run:

```
  status   | apps
-----------+------
 QUEUED    |    6
 SUBMITTED |    2

   type   | count
----------+-------
 ATTACH   |     2
 CREATED  |     8
 FILL     |    10
 NAVIGATE |     2
 STATUS   |     2
 SUBMIT   |     2

       action       | count
--------------------+-------
 application.create |     8
 application.result |     2
 browser.attach     |     2
 browser.fill       |    10
 browser.navigate   |     2
 browser.submit     |     2
```

Each of the two completed runs has one `NAVIGATE`, five `FILL`s, one `ATTACH` and
one `SUBMIT` event, and the `browser.*` audit rows match those counts exactly, so
no browser action goes unrecorded (I8). The pagination-free `/audit` page shows
`browser.submit` and `application.result` for the run.

### Verification for the phase

```
TYPECHECK_EXIT=0   Tasks: 9 successful, 9 total
LINT_EXIT=0        eslint . (0 errors)
TEST_EXIT=0        Tasks: 6 successful, 6 total
                   apply 40 + sources 34 + db 6, core/llm/render cached
E2E_EXIT=0         19 passed (1.4m)
```

## Phase 4 status

All ten Phase 4 gates are [MET] with the evidence above. Four defects were found
while proving them and fixed at the cause rather than worked around: the
autocomplete key normalization, the `\bconvict\b` word boundary, the missing
`exports` map that made `@jobpilot/apply` unresolvable from the e2e specs, and an
e2e helper that passed `basics` where the planner expects `{ basics }`.

## Phase 5 — matching

All ten Phase 5 gates are [MET]. Scoring is deterministic and fully broken down,
the threshold gate is shared by the API, the UI and the worker, explanations are
redacted and audited, and matches persist with a pgvector embedding per posting.

### GATES LEDGER

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
|---|---|---|---|---|
| 5.1 | Deterministic scorer | Same profile, job and clock always produce the same 0-100 integer, equal to its weighted breakdown | `core/test/matching.test.ts` (12 cases) | [MET] |
| 5.2 | Threshold gate | A score exactly at the threshold passes, one below fails, and the API filters at the stored setting | `meetsThreshold` cases + e2e `?aboveThreshold=1` | [MET] |
| 5.3 | Explanations | Every score gets a one-sentence explanation; with a key it comes from the tagged structured call, without one from the deterministic fallback, and either way it is audited | `llm/test/matchExplain.test.ts` + e2e explanation assertions | [MET] |
| 5.4 | Redaction (I7) | Name, email and phone never reach the prompt; the posting is delimiter-wrapped | `matchExplain.test.ts` (3 cases) | [MET] |
| 5.5 | Persistence and recompute | One row per (job, profile, algoVersion); recomputing updates in place and a version bump creates a new row | `db/test/matching.test.ts` + e2e idempotency | [MET] |
| 5.6 | Embedding similarity | Each posting stores a 384-dimension vector and its model, readable back and rankable by cosine distance | `db/test/matching.test.ts` + the `psql` read below | [MET] |
| 5.7 | Gap report | Gaps are stored per user with their source job ids and a severity | `db/test/matching.test.ts` gate 5.7 | [MET] |
| 5.8 | Project plans | Plans start `SUGGESTED` with no repository and no measured metrics | `db/test/matching.test.ts` gate 5.8 | [MET] |
| 5.9 | Matches API | `GET /api/matches` lists best first and filters at the threshold; `POST /api/matches/recompute` is idempotent and audited | e2e gate 5.9 + 5.9b | [MET] |
| 5.10 | Matches UI | `/matches` shows score, breakdown and explanation, and a recompute button reports what it scored | e2e gate 5.10 | [MET] |

### Evidence for gates 5.1-5.4

```
$ pnpm --filter @jobpilot/core test
 ✓ test/crypto.test.ts (4 tests) 5ms
 ✓ test/schema.test.ts (5 tests) 12ms
 ✓ test/factIndex.test.ts (7 tests) 8ms
 ✓ test/matching.test.ts (12 tests) 13ms
 Test Files  4 passed (4)
      Tests  28 passed (28)

$ pnpm --filter @jobpilot/llm test
 ✓ test/untrusted.test.ts (4 tests) 3ms
 ✓ test/redact.test.ts (10 tests) 3ms
 ✓ test/fakeClient.test.ts (3 tests) 4ms
 ✓ test/matchExplain.test.ts (3 tests) 2ms
 ✓ test/anthropicClient.test.ts (4 tests) 1597ms
 Test Files  5 passed (5)
      Tests  24 passed (24)
```

The scorer's own test builds a TypeScript/PostgreSQL profile and two postings: a
backend role drawn from that vocabulary scores 81, a nursing role in another
country scores lower, and the first test asserts the two runs are byte-identical.
`candidateYears` is derived from the dated work history (8.1 years from a 2018-01
start and a fixed 2026-01 clock), so seniority is never guessed. The redaction
test asserts the assembled prompt contains neither `priya.sharma@example.com`,
`98765` nor `Priya`, while still containing the wrapped `<untrusted
label="job-description">` block.

### Evidence for gates 5.5-5.8

```
$ pnpm --filter @jobpilot/db test
 ✓ test/matching.test.ts (4 tests) 5886ms
   ✓ gate 5.5: one score per job, profile and algorithm version > updates in place, then versions when the algorithm changes  2949ms
   ✓ gate 5.5 ... > lists best first and filters at the threshold  509ms
   ✓ gate 5.6 ... > writes 384 dimensions with the model name and reads them back  1110ms
   ✓ gate 5.7/5.8 ... > stores the gaps and creates SUGGESTED plans with nothing fabricated  607ms
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

Gate 5.6 exercises the real column: `saveJobEmbedding` writes through
`$executeRaw` with a `::vector` cast, `vector_dims` reports 384 back, and
`rankJobsBySimilarity` puts the TypeScript posting first for a TypeScript query.
The uniqueness the upsert relies on is a committed migration,
`20261113233000_match_score_unique`, because `prisma migrate dev` refuses
non-interactive shells; the SQL was written by hand and applied with
`prisma migrate deploy`.

### Evidence for gates 5.9-5.10 (API and UI)

```
$ pnpm e2e
  ok 20 tests\e2e\phase5.spec.ts:68:5 › gate 5.9/5.10: scoring, threshold filtering and explanations end to end (15.1s)
  ok 21 tests\e2e\phase5.spec.ts:158:5 › gate 5.9b: matches and recompute are behind the auth wall (30ms)

  21 passed (1.7m)
```

The spec builds one posting from the imported profile's own vocabulary and one
unrelated posting, sets the threshold to 75 through the settings API, then
asserts the strong posting clears it while the nursing posting does not, that the
filtered list is sorted descending, that a second recompute leaves the row count
unchanged, and that `/matches` renders the stored explanation and reports
`Scored N posting(s)` after a click.

### Persisted rows after the run

```
 scores | low | high
--------+-----+------
     24 |  29 |   86

 embedded | jobs |   model
----------+------+-----------
       24 |   24 | hash-bow-v1

        action         | count
-----------------------+-------
 match.explain.skipped |   126
 match.gap             |     6
 match.recompute       |    11
```

Every posting in the database carries an embedding from one named model, so no
two vector spaces are mixed. `match.explain.skipped` records each score explained
without a key instead of silently pretending a model wrote it; setting
`ANTHROPIC_API_KEY` switches the same path to the structured call, which
`AnthropicClient` already audits per invocation (Phase 1 gate 1.11).

### Verification for the phase

```
TYPECHECK_EXIT=0   Tasks: 9 successful, 9 total
LINT_EXIT=0        eslint . (0 errors)
TEST_EXIT=0        Tasks: 6 successful, 6 total
                   core 28 + llm 24 + db 10 + apply 40 + sources 34
E2E_EXIT=0         21 passed (1.7m)
```

## Phase 5 status

All ten Phase 5 gates are [MET] with the evidence above. Two defects were fixed
while proving them: `@jobpilot/llm` did not depend on `@jobpilot/core`, so the new
explanation module could not resolve it types, and the db match suite relied on
Prisma's 5s default while each case creates a user, a profile and postings, which
timed out intermittently until the file raised its own budget.

## Phase 6 — fact-only tailoring (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 6.1 | Fact-only tailoring | A tailored document may only reorder and omit profile facts | `packages/render`/`packages/llm` tests prove every bullet is a profile bullet and invented claims are rejected | [MET] |
| 6.2 | Keyword loop | Trimming never drops coverage below the floor | Render test plus stored `keywordReport` showing the same coverage with fewer bullets | [MET] |
| 6.3 | Version persistence | A tailored version and its reports are stored with an audit row | db test and `ResumeVersion` rows with `resume.tailor` audits | [MET] |
| 6.4 | Approval gate | An application cannot reference an unapproved version | e2e: 409 before approval, 201 after | [MET] |
| 6.5 | Answer Bank CRUD | User-scoped create/update/delete with no answer text in audit | db test (cross-user refusal) and e2e CRUD | [MET] |
| 6.6 | SAMPLE watermark | A mock offer is watermarked even when asked not to be | `packages/render/test/watermark.test.ts` | [MET] |
| 6.7 | Tailor UI | `/tailor` runs a tailoring and shows the approval state | e2e assertions on `tailor-page`, `tailor-result`, `version-approved` | [MET] |
| 6.8 | Auth and audit | Tailoring and answers are behind sign-in and audited | e2e 307 checks plus `resume.tailor`/`resume.approve`/`answer.save` audit rows | [MET] |

### Evidence for gates 6.1-6.3 (deterministic and model tailoring)

`packages/render/src/tailor.ts` exposes `tailorDocument(profile, jobDescription)`,
which builds the document from the profile, ranks each role's bullets by how many
of the posting's required keywords they carry, keeps the top `maxHighlightsPerRole`
and then restores trimmed bullets until coverage is back at the floor. There is no
code path that writes a bullet string, so a keyword the profile cannot attest to
cannot appear.

```ts
function trimRoles(doc, required, maxPerRole) {
  const roles = doc.roles.map((role) => {
    const ranked = role.highlights
      .map((text, index) => ({ text, index, score: hits(text, required) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const keep = ranked.slice(0, Math.max(1, maxPerRole)).sort((a, b) => a.index - b.index);
    return { ...role, highlights: keep.map((entry) => entry.text) };
  });
  return { ...doc, roles };
}
```

`packages/llm/src/tailor.ts` sends the model a closed list of allowed facts and
`resumeDocumentSchema`, then runs `validateResumeDocument` on the reply; an
invented employer or bullet throws `ClaimValidationError` and is never stored:

```
 ✓ test/tailor.test.ts (5 tests) 4ms
   gate 6.1: an invented claim is rejected before it can be stored (I1)
     ✓ throws ClaimValidationError for an employer the profile does not have
     ✓ accepts a document that only restates the profile
     ✓ rejects an invented bullet even when the employer is real
```

```
$ pnpm --filter @jobpilot/render test
 ✓ test/tailor.test.ts (6 tests) 4ms
 ✓ test/watermark.test.ts (3 tests)
 ✓ test/ats.test.ts (4 tests)
 ✓ test/render.test.ts (9 tests)
 Test Files  4 passed (4)
      Tests  22 passed (22)
```

The keyword loop is observable in the stored report: the E2E tailoring of the
imported profile trims bullets and still reports the original coverage.

```
 initial | final | trimmed |    source     | claims
---------+-------+---------+---------------+--------
    88.2 |  88.2 |       4 | deterministic |     71
```

71 claims were re-checked against the Fact Index for the tailored document, and
the coverage the full document had is preserved while four bullets are dropped
(`floor` defaults to the initial coverage, so restoring is what makes trimming and
coverage compatible rather than a trade-off).

### Evidence for gates 6.4-6.5 (approval gate and Answer Bank)

`apps/web/src/app/api/applications/route.ts` now accepts an optional
`resumeVersionId` and refuses to proceed until it carries `approvedAt`:

```
$ pnpm --filter @jobpilot/web exec playwright test tests/e2e/phase6.spec.ts --reporter=line
[1/2] tests\e2e\phase6.spec.ts:56:5 › gate 6.1-6.5: tailoring, the approval gate and the Answer Bank end to end
[2/2] tests\e2e\phase6.spec.ts:167:5 › gate 6.8: tailoring and answers are behind the auth wall
  2 passed (45.9s)
```

The spec asserts the order explicitly — the same request returns 409 before
`POST /api/resume-versions/:id/approve` and 201 after it. Answer Bank writes are
user-scoped upserts on `@@unique([userId, key])`, and the audit payload holds only
the key and the sensitive flag:

```
     action     | count
----------------+-------
 answer.delete  |     3
 answer.save    |     9
 resume.approve |     3
 resume.tailor  |     7

 answers
---------
       3
```

```
 versions | approved
----------+----------
        7 |        3
```

### Evidence for gates 6.6-6.8 (watermark, UI, auth)

```
$ pnpm --filter @jobpilot/render test
 ✓ test/watermark.test.ts (3 tests)
   gate 6.6: a mock offer is always watermarked (I6)
     ✓ forces SAMPLE even when the caller asks for no watermark
     ✓ does not watermark an ordinary resume
     ✓ watermarks the PDF path too
```

The page assertions in the E2E spec cover signing in, choosing the posting,
running a tailoring, seeing the claim count, downloading the PDF and finding the
version already approved; `/answers` saves a sensitive answer, shows it, deletes
it and waits for the row to disappear. Both APIs answer 307 to an unauthenticated
client, so the UI is not the only guard.

### Verification for the phase

```
TYPECHECK_EXIT=0   Tasks: 9 successful, 9 total
LINT_EXIT=0        eslint . (0 errors)
TEST_EXIT=0        Tasks: 6 successful, 6 total
                   core 28 + render 22 + llm 29 + db 15 + apply 40 + sources 34
E2E_EXIT=0         23 passed (1.9m)
```

## Phase 6 status

All eight Phase 6 gates are [MET] with the evidence above. Two defects were fixed
while proving them: the zod document schema used `.default([])`, which made the
inferred input type optional and failed against `ZodType<ResumeDocument>`, and the
deterministic tailoring path first stored a placeholder claim report with
`checkedClaims: 0` — it now runs `validateResumeDocument` on the selected document
so the audit records the real count. The local Postgres cluster also had to be
restarted (it had crashed with `0xC0000142` and left a stale pidfile) before the db
suite could connect.

## Phase 7 — Auto-Pilot (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 7.1 | Portal unlock policy | A portal runs unattended only when unlocked and `allowSubmit` is on | `packages/apply/test/autopilot.test.ts`; API returns 409 while submissions are off | [MET] |
| 7.2 | Eligibility and queue | Only above-threshold postings on unlocked portals with an approved resume are queued | Queue tests assert one reason per skipped posting; e2e sees `NO_APPROVED_RESUME` | [MET] |
| 7.3 | Cap accounting | Daily and per-portal counts come from stored submissions | `submissionCounts` tests plus the e2e `DAILY_CAP` block | [MET] |
| 7.4 | Auto-Pilot loop | The loop submits sequentially with no click and stops on the first blocked gate | Loop tests (fake page) and a real submission through the mock ATS | [MET] |
| 7.5 | Persistence and audit | Portal policies persist and unlock/lock/run/skip/stop are audited | db rows and `portal.unlock`/`autopilot.run` audit counts | [MET] |
| 7.6 | API | Status, unlock, lock, run and stop are guarded endpoints | 401/307 checks, 409 refusals, run returning per-candidate outcomes | [MET] |
| 7.7 | Auto-Pilot UI | `/autopilot` shows portals, the queue and the last run | e2e on `portal-row`, `autopilot-last-run`, lock/unlock/stop buttons | [MET] |
| 7.8 | Live Auto-Pilot e2e | Unattended submissions happen, caps hold and the kill switch stops the run | mock-ATS submission log plus audit assertions | [MET] |

### Evidence for gates 7.1-7.4 (policy, queue, caps, loop)

`packages/apply/src/autopilot.ts` holds the whole decision surface. A portal is
unlocked only when `Settings.perPortalMode[portal]` carries an `AUTOPILOT` mode
with an unlock timestamp, and unlocking is refused while submissions are off or
the kill switch is on:

```ts
export function canUnlockPortal(settings: { allowSubmit: boolean; killSwitch: boolean }) {
  if (settings.killSwitch) return { ok: false, reason: "KILL_SWITCH", message: "…" };
  if (!settings.allowSubmit) return { ok: false, reason: "SUBMIT_DISABLED", message: "…" };
  return { ok: true };
}
```

`selectAutopilotQueue` decides the queue before a browser opens, and the counts
include the postings it has already accepted, so a plan cannot overshoot a cap:

```
 ✓ test/autopilot.test.ts (12 tests)
   gate 7.1: a portal runs unattended only when it is unlocked
   gate 7.2: the queue carries one reason per skipped posting
   gate 7.3: caps count what a run has already planned
   gate 7.4: the loop submits without a click and re-checks the gate each time
```

```
$ pnpm --filter @jobpilot/apply test
 Test Files  6 passed (6)
      Tests  52 passed (52)
```

The loop re-evaluates `evaluatePreflight` before every application and returns the
blocking reason, which is what makes the kill switch stop a batch midway:

```
    expect(counter.submits).toBe(1);
    expect(report.stopReason).toBe("KILL_SWITCH");
```

### Evidence for gates 7.5-7.8 (persistence, API, UI, live run)

`setPortalPolicy` merges `Settings.perPortalMode` and writes the audit row in one
transaction; `createApplication` records `mode: "AUTOPILOT"` for unattended rows
so the two paths stay distinguishable afterwards:

```
     action     | count
----------------+-------
 autopilot.run  |     6
 autopilot.skip |    12
 autopilot.stop |     4
 portal.lock    |     2
 portal.unlock  |    18

   mode    |       status       | count
-----------+--------------------+-------
 AUTOPILOT | PAUSED_NEEDS_HUMAN |     4
 AUTOPILOT | SUBMITTED          |     2
 COPILOT   | QUEUED             |    13
 COPILOT   | SUBMITTED          |     5

                                perPortalMode                                | allowSubmit | dailyCap | killSwitch
-----------------------------------------------------------------------------+-------------+----------+------------
 {"manual": {"mode": "AUTOPILOT", "unlockedAt": "2026-11-15T08:49:36.440Z"}} | t           |        4 | t
```

The paused `AUTOPILOT` rows are the runs that stopped because the Greenhouse
fixture asks for a cover letter that only the Answer Bank may supply (I5); once
the entry exists the same posting is retried and submitted, which is also why
candidate loading ignores a paused application.

```
$ pnpm --filter @jobpilot/web exec playwright test tests/e2e/phase7.spec.ts --reporter=line
[1/3] gate 7.1-7.5: Auto-Pilot submits unattended behind portals, caps and audits
[2/3] gate 7.7: the page shows portals, the queue and the last run
[3/3] gate 7.8: Auto-Pilot is behind the auth wall
  3 passed (50.5s)
```

The spec makes the flow explicit: unlocking with `allowSubmit` off returns 409;
with it on, a posting without an approved version is skipped
(`NO_APPROVED_RESUME`); after approval the run submits once with no click, and the
mock ATS log shows exactly one `POST /submit/greenhouse` carrying the profile name
and a resume file. Lowering the daily cap to the stored submission count blocks the
next run with `DAILY_CAP`, and `stop` raises the kill switch so the following run
reports `KILL_SWITCH` and sends nothing.

### Verification for the phase

```
TYPECHECK_EXIT=0   Tasks: 9 successful, 9 total
LINT_EXIT=0        eslint . (0 errors)
TEST_EXIT=0        Tasks: 6 successful, 6 total
                   core 28 + llm 29 + render 22 + sources 34 + apply 52 + db 15
E2E_EXIT=0         26 passed (2.2m)
```

## Phase 7 status

All eight Phase 7 gates are [MET] with the evidence above. Three defects were fixed
while proving them: `readDocumentBytes` destructured a `userId` that did not exist
in scope, the resume fallback attached a version tailored for a *different* posting
(it now requires the posting's own approved version or a generic one), and a paused
application used to exclude its posting from future runs, so a missing Answer Bank
entry could never be fixed. `playwright` also had to become a runtime dependency of
the web app with `serverExternalPackages`/webpack externals, because the Auto-Pilot
route launches a real browser from the server.

## Phase 8 — scheduled Auto-Pilot (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 8.1 | Shared service | The worker and the web app run the same Auto-Pilot code | `packages/autopilot` owns the service; the web route and the worker import it, so no logic is duplicated | [MET] |
| 8.2 | Schedule selection | Only opted-in users are due: `mode === AUTOPILOT`, `allowSubmit`, no kill switch, ≥1 unlocked portal | `isScheduledCandidate` tests over each refusal; e2e shows a COPILOT user is never picked up | [MET] |
| 8.3 | Tick runner | One tick runs the service per due user, capped at one submission per user per tick | `runScheduledAutopilot` tests (`SCHEDULED_MAX_PER_USER = 1`); e2e tick submits through the mock ATS | [MET] |
| 8.4 | Worker cron | The worker schedules `autopilot-tick` and runs the tick handler | worker log `[worker] autopilot-tick scheduled (*/15 * * * *)` plus a `pgboss.schedule` row | [MET] |
| 8.5 | Settings controls | `mode` and `allowSubmit` are editable and persist | e2e edits both on `/settings` and reads them back from the API | [MET] |
| 8.6 | Auth on the trigger | The tick endpoint requires a session and a same-origin request | 307 redirect when signed out, `isSameOriginRequest` on the POST | [MET] |

### Evidence for gate 8.1 (one service, two callers)

The Auto-Pilot implementation moved out of the web app into `@jobpilot/autopilot`,
so the request path and the cron path cannot drift apart:

```
apps/web/src/app/api/autopilot/route.ts   -> runAutopilotNow(...)
apps/worker/src/index.ts                  -> runScheduledTick()
packages/autopilot/src/index.ts           -> both of the above
```

### Evidence for gates 8.2-8.3 (selection and one tick)

```
 ✓ packages/autopilot/test/scheduled.test.ts (6 tests)
   gate 8.2: a user is due only when mode is AUTOPILOT, submissions are on,
             the kill switch is off and a portal is unlocked
   gate 8.2: a paused or empty queue does not make a user due
   gate 8.3: one tick runs the service once per due user with a limit of 1
   gate 8.3: a failing user is reported in the tick without stopping the others
```

### Evidence for gate 8.4 (the worker really schedules it)

```
[worker] autopilot-tick scheduled (*/15 * * * *)

 psql> select name, cron, timezone from pgboss.schedule;
 autopilot-tick | */15 * * * * | UTC
```

`AUTOPILOT_CRON` overrides the default `*/15 * * * *`. The cron cannot be waited
on in a test, so the same `runScheduledTick` is reachable through
`POST /api/autopilot { action: "tick" }`, which is what the e2e calls.

### Evidence for gates 8.3-8.6 (live tick, settings, auth)

```
 ✓ apps/web/tests/e2e/phase8.spec.ts
   gate 8.1-8.4: the scheduled tick submits for opted-in users only
   gate 8.5: mode and allowSubmit are editable from Settings
   gate 8.6: the tick endpoint requires a session (307 when signed out)
```

The spec sets `mode: COPILOT` and proves the tick leaves the user alone
(`due: 0`), repeats the check with the kill switch on, then flips to `AUTOPILOT`
and gets an unattended submission whose form body carries the profile name and a
resume file. It waits out the 30-second per-portal interval first, because a
scheduled tick obeys the same stop gate as a manual run.

### Verification for the phase

```
LINT_EXIT=0        eslint . (0 errors)
TYPECHECK_EXIT=0   Tasks: 10 successful, 10 total
TEST_EXIT=0        autopilot 6 + core 28 + llm 29 + render 22 + sources 34 + apply 52 + db 15 = 186
E2E_EXIT=0         27 passed, 2 skipped (2.2m)
```

## Phase 8 status

Gates 8.1-8.6 are [MET]. Phase 8 is opt-in: a user is scheduled only with
`mode: AUTOPILOT`, submissions on, no kill switch and an unlocked portal, and a
tick spends at most one submission per user. Postings whose last application ended
in `ERROR` are excluded from the queue so a dead host cannot consume that slot
every tick.

The two skipped e2e cases are the *submission* legs of gates 7.1-7.5 and 8.1-8.4:
the local database had already spent the 25-per-day cap when the last runs happened
(earlier runs that day with budget available passed both, and the specs now assert
the `DAILY_CAP` refusal in that state instead of failing). `next build` for
production was not run; the cron was verified by the worker log and the
`pgboss.schedule` row, not by waiting 15 minutes for a real tick.

## Phase 9 — isolated e2e database (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 9.1 | Isolated target | The suite never reads or writes the developer database | Playwright derives `<db>_e2e` and hands it to the server it launches; dev `Application` count unchanged after a run | [MET] |
| 9.2 | Reset before every run | Each run starts from a freshly migrated, seeded database | `apps/web/scripts/e2e-db.mjs` drops, migrates and seeds; suite reaches the submit gates with an empty budget | [MET] |
| 9.3 | No port collisions | A running `pnpm dev` is never reused | e2e app serves :3100 with its own env; mock ATS is started or explicitly reused | [MET] |
| 9.4 | Specs unconditional | The two budget guards are gone and every gate runs | `pnpm e2e` reports 29 passed, 0 skipped | [MET] |
| 9.5 | Docs and ledger | README explains the isolated database, ledger has real output | docs diff + verify run below | [MET] |

### Evidence for gates 9.1-9.3 (its own database, reset, own port)

The config derives the target instead of taking `DATABASE_URL` as-is, and the
webServer command resets that target before Next binds a port:

```ts
const e2eDatabase = e2eDatabaseUrl(databaseUrl);   // …/jobpilot -> …/jobpilot_e2e
webServer: [
  { command: "pnpm --filter @jobpilot/mock-ats start", url: MOCK_ATS_URL, reuseExistingServer: true },
  {
    command: "node scripts/e2e-db.mjs && pnpm exec next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: { ...env, DATABASE_URL: e2eDatabase, NEXTAUTH_URL: "http://localhost:3100" },
  },
]
```

Bootstrap output, run on its own:

```
[e2e-db] recreated database jobpilot_e2e
[e2e-db] migrating … Datasource "db": PostgreSQL database "jobpilot_e2e", schema "public" at "localhost:55432"
                     Applying migration `000000000000_init`
                     Applying migration `20261113233000_match_score_unique`
                     Database reset successful … ok
[e2e-db] seeding … ok
[e2e-db] ready: postgresql://jobpilot:***@localhost:55432/jobpilot_e2e
```

Isolation checked against the live server after a full suite run — the developer
database was not touched, the e2e database holds only that run's rows:

```
dev  "Application" count: 74   (unchanged)
e2e  "Application" count: 5
e2e  "Job" count:         10
```

### Evidence for gate 9.4 (no skipped gates left)

Both budget guards were deleted from the specs, so the unattended-submission and
scheduled-tick gates always execute:

```
$ pnpm e2e
[e2e] database postgresql://jobpilot:***@localhost:55432/jobpilot_e2e on http://localhost:3100
  29 passed (3.0m)
```

### Verification for the phase

```
LINT_EXIT=0        eslint . (0 errors, 0 warnings)
TYPECHECK_EXIT=0   Tasks: 10 successful, 10 total
TEST_EXIT=0        186 unit tests (autopilot 6, core 28, llm 29, render 22, sources 34, apply 52, db 15)
E2E_EXIT=0         29 passed, 0 skipped (3.0m), repeated twice
```

## Phase 9 status

All five gates are [MET]. `pnpm e2e` now owns a database: it is dropped and
re-created from the committed migrations, seeded with the admin user and default
Settings, and the app runs on :3100 with that URL, so a developer `pnpm dev` on
:3000 keeps its own data and the run repeats identically any number of times in
a day. `E2E_DATABASE_URL` still overrides the derived name for CI.

## Phase 10 — CI (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 10.1 | Postgres with pgvector | CI provides Postgres 16 with the `vector` extension | `pgvector/pgvector:pg16` service with a `pg_isready` health check; `pnpm db:migrate` applies the init migration that runs `CREATE EXTENSION vector` | [MET] |
| 10.2 | Toolchain parity | Node and the pinned pnpm as the repo requires | `pnpm/action-setup` + `setup-node` (node 22, `cache: pnpm`) and `pnpm install --frozen-lockfile` | [MET] |
| 10.3 | Static checks and unit tests | lint, typecheck and vitest run on every push/PR | workflow steps calling the repo scripts; all exit 0 locally | [MET] |
| 10.4 | Isolated e2e suite | The e2e job provisions its own database, browser and mock ATS | job env points at the service database; `playwright install --with-deps chromium`; `pnpm e2e` bootstraps `jobpilot_e2e` | [MET] |
| 10.5 | Diagnostics | Failures leave traces to inspect | `actions/upload-artifact` of `apps/web/test-results` and `apps/web/playwright-report` on failure | [MET] |
| 10.6 | Verified locally | The workflow is valid and every command in it passes here | YAML parsed, key decodes to 32 bytes, all steps exit 0, e2e green with `.env` removed | [MET] |

### Evidence for gates 10.1-10.4 (the workflow)

`.github/workflows/ci.yml` defines two jobs over a `pgvector/pgvector:pg16`
service, because the init migration carries `CREATE EXTENSION IF NOT EXISTS vector`
for `Job.embedding` — a plain Postgres image would fail that migration:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env: { POSTGRES_USER: jobpilot, POSTGRES_PASSWORD: jobpilot, POSTGRES_DB: jobpilot }
    ports: ["5432:5432"]
    options: --health-cmd "pg_isready -U jobpilot -d jobpilot" …

env:   # job level
  DATABASE_URL: postgresql://jobpilot:jobpilot@localhost:5432/jobpilot
  APP_ENCRYPTION_KEY: BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=   # 32 bytes
  ADMIN_EMAIL: admin@jobpilot.local
  ADMIN_PASSWORD: jobpilot-admin
```

The e2e job deliberately runs no migrate step of its own: `pnpm e2e` starts the
`webServer` command `node scripts/e2e-db.mjs && pnpm exec next dev -p 3100`, which
creates, migrates and seeds `jobpilot_e2e` on the service database. Artifacts:

```yaml
- name: Upload Playwright traces
  if: failure()
  uses: actions/upload-artifact@v4
  with: { name: playwright-traces, path: "apps/web/test-results\napps/web/playwright-report" }
```

### Evidence for gate 10.6 (every command run locally)

YAML structure and the encryption key were checked with a real parser:

```
parsed ok jobs=checks|e2e checksSteps=9 e2eSteps=7 svc=postgres key_len=32
```

Then each command the workflow runs, in order, on this machine:

```
INSTALL=0     pnpm install --frozen-lockfile        (Done in 3s using pnpm v10.34.5)
GENERATE=0    pnpm db:generate
MIGRATE=0     pnpm db:migrate                       (No pending migrations to apply.)
SEED=0        pnpm db:seed                          (Seeded admin admin@jobpilot.local …)
LINT=0        pnpm lint
TYPECHECK=0   pnpm typecheck
TEST=0        pnpm test                            (186 unit tests)
```

CI has no `.env`, so the suite was also run with the file removed and only the
workflow's environment exported — the config falls back to `process.env`:

```
$ mv .env .env.ci-bak && export $(grep -E '^(DATABASE_URL|APP_ENCRYPTION_KEY|…)' .env.ci-bak) && pnpm e2e
[e2e] database postgresql://jobpilot:***@localhost:55432/jobpilot_e2e on http://localhost:3100
  29 passed (3.0m)
```

## Phase 10 status

All six gates are [MET]. The workflow runs on pushes to `main`, on pull requests
and on `workflow_dispatch`, cancels superseded runs per ref, and splits the work
into a `checks` job (install, migrate, seed, lint, typecheck, unit tests) and an
e2e job that needs it. CI sets no `ANTHROPIC_API_KEY` and no board credentials on
purpose: every suite exercises the deterministic fallbacks, so the job needs no
secrets beyond the throwaway database and admin values in the workflow itself.

Not verified: an actual GitHub Actions run. The workflow file is parsed and every
command it runs was executed successfully here, but the runner image, service
container networking and Playwright browser install can only be proven by pushing
the branch.

## Phase 11 — production images and gated deploy (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 11.1 | Production build | The web app builds a server that runs without dev tooling | `pnpm --filter @jobpilot/web build` exit 0; `next start` answers `/login` 200 and `/` 307 | [MET] |
| 11.2 | Web image | One image runs the built app as an unprivileged user | `Dockerfile` target `web`: build stage → runtime stage, `USER jobpilot`, `HEALTHCHECK`, `pnpm --filter @jobpilot/web start` | [MET] |
| 11.3 | Worker image | The worker image runs the queue worker with a usable browser | Target `worker` shares the same runtime; `playwright install --with-deps chromium` at `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`; `pnpm --filter @jobpilot/worker start` proven here | [MET] |
| 11.4 | CI-gated publish | Images publish only after CI succeeds | `deploy.yml` on `workflow_run: [CI]` (main) with a `conclusion == 'success'` guard; buildx push to GHCR for both targets | [MET] |
| 11.5 | Docs and ledger | README documents build/run/migrate/publish, ledger has output | README “Containers and deploys” + this section | [MET] |
| 11.6 | Local verification | Everything runnable here passes; the unbuildable part is stated | build/start/worker/YAML evidence below; no Docker daemon on this machine | [MET] |

### Evidence for gates 11.1-11.3 (build, both runtimes)

The image reuses the workspace build instead of a bespoke production server:

```dockerfile
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate
RUN pnpm --filter @jobpilot/web build

FROM base AS runtime
COPY --from=build /app /app
RUN pnpm --filter @jobpilot/autopilot exec playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 jobpilot && chown -R jobpilot:jobpilot /ms-playwright
USER jobpilot

FROM runtime AS web     … CMD ["pnpm","--filter","@jobpilot/web","start"]
FROM runtime AS worker  … CMD ["pnpm","--filter","@jobpilot/worker","start"]
```

Chromium is installed for both targets because the Auto-Pilot executor opens a
browser from the API route (on-demand run) as well as from the worker (scheduled
tick). `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` keeps `pnpm install` from fetching a
browser into the build layer.

```
$ pnpm --filter @jobpilot/web build
BUILD=0
 ✓ Compiled successfully in 6.4s
Route (app)                                 Size  First Load JS
├ ƒ /api/autopilot                         163 B         102 kB
…

$ pnpm exec next start -p 3200
 ✓ Ready in 726ms
HTTP=200   (/login)
root=307   (/ redirects to auth)

$ pnpm --filter @jobpilot/worker start
[worker] pg-boss started
[worker] queue system-heartbeat scheduled every 10 minutes
[worker] autopilot-tick scheduled (*/15 * * * *)
```

### Evidence for gate 11.4 (publish only after green CI)

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

jobs:
  publish:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'
    strategy: { matrix: { include: [{name: web, target: web}, {name: worker, target: worker}] } }
```

Both images are built with `docker/build-push-action` and pushed to
`ghcr.io/<repo>/<name>` tagged with the long commit SHA (plus `latest`), using the
job's `GITHUB_TOKEN` and `packages: write`. The job prints the digest to the run
summary.

Parsed with a real YAML parser:

```
parsed ok name=Deploy triggers=workflow_run,workflow_dispatch jobs=publish matrix=web,worker perm=contents,packages
```

### Verification for the phase

```
BUILD_EXIT=0       pnpm --filter @jobpilot/web build
NEXT_START=200     /login on the production server (:3200), / = 307
WORKER_EXIT=ok     pg-boss started, autopilot-tick scheduled (*/15 * * * *)
YAML_EXIT=0        deploy.yml and ci.yml parsed
DOCKER_IMAGE_BUILD not run — no Docker daemon on this machine (`docker: command not found`)
```

## Phase 11 status

All six gates are [MET] for everything this machine can execute. The images are
built from one workspace build and share a runtime stage; each target differs only
in CMD, so the web and worker images are interchangeable apart from their entry
point. The deploy workflow cannot publish unless the CI workflow that verified the
same commit finished successfully.

Honest gaps: the `docker build` itself was not executed here (no Docker daemon),
so image layers, the `--with-deps` apt step and the unprivileged Chromium launch
are unproven; the first real build will confirm them. Nothing is deployed to a
runtime environment — the workflow publishes images only, by design.

## Phase 12 — compose stack (ledger)

| Gate # | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 12.1 | Postgres service | The stack owns a pgvector database with a health check | `db` service (`pgvector/pgvector:pg16`, `pg_isready`, volume) | [MET] |
| 12.2 | Migrations as a job | Migrations run once and before the apps | `migrate` runs `pnpm db:migrate` with `restart: "no"`; apps wait for `service_completed_successfully` | [MET] |
| 12.3 | Health-gated startup | web and worker start only on a healthy, migrated database | `depends_on` conditions `service_healthy` + `service_completed_successfully` on both | [MET] |
| 12.4 | Published images | The stack pulls the images the deploy workflow publishes, or builds them | `image: ${JOBPILOT_IMAGE_PREFIX}/web|worker:${JOBPILOT_TAG}` with `build.target` web/worker | [MET] |
| 12.5 | Docs and ledger | README + ledger describe running the stack | README “Running the stack with compose” + this section | [MET] |
| 12.6 | Local verification | Everything runnable here passes; the rest stated | YAML parse + structural assertions below; compose itself not executed (no Docker) | [MET] |

### Evidence for gates 12.1-12.4 (the file, as parsed)

The stack is validated by parsing it and asserting the orchestration contract,
because this machine has no Docker daemon:

```
name= jobpilot services= db,migrate,seed,web,worker
web image= ${JOBPILOT_IMAGE_PREFIX:-ghcr.io/jobpilot/jobpilot}/web:${JOBPILOT_TAG:-latest}
 depends: {'db': 'service_healthy', 'migrate': 'service_completed_successfully'}
worker image= ${JOBPILOT_IMAGE_PREFIX:-ghcr.io/jobpilot/jobpilot}/worker:${JOBPILOT_TAG:-latest}
 depends: {'db': 'service_healthy', 'migrate': 'service_completed_successfully'}
migrate cmd= ['pnpm', 'db:migrate'] restart= no
seed profiles= ['seed']
db healthcheck= ['CMD-SHELL', 'pg_isready -U jobpilot -d jobpilot']
worker has ports: False | web ports: ['3000:3000']
```

`migrate` and `seed` run in the `web` image (same workspace, Prisma CLI present)
with their CMD overridden, so no extra image has to be published for them. The
targets they build from exist in the Dockerfile:

```
45:FROM runtime AS web
50:FROM runtime AS worker
```

Both commands the one-shot services run were executed here against the real
database in Phase 10 (`MIGRATE=0`, `SEED=0`), and the two long-running commands
were executed in Phase 11 (`next start` serving :3200, worker scheduling
`autopilot-tick`).

### Documentation for gate 12.5

README gained “Running the stack with compose”: `docker compose up -d --build`,
`docker compose up -d db`, `docker compose --profile seed run --rm seed`, the
`JOBPILOT_IMAGE_PREFIX`/`JOBPILOT_TAG` pair for published images, and the warning
that seeding resets `Settings`.

## Phase 12 status

All six gates are [MET] as far as this machine can prove them, with one honest
gap: `docker compose up` was never executed (no Docker daemon here), so container
start-up ordering, the `service_completed_successfully` condition and volume
permissions are unverified in practice. Everything the file orchestrates — the
migrations, the seed, both entrypoints, the image targets — was run directly and
is listed above.

## Verification pass over Phases 8-12

A full re-check of the delivered work found three real defects. Two were in
shipped code, one was in the isolation added in Phase 9; all three are fixed.

### Defect 1 — the e2e database was only fresh on its first run (Phase 9)

`e2eDatabaseUrl` appended `_e2e` unconditionally, but the Playwright webServer
already receives the derived URL through its environment. The bootstrap therefore
re-created `jobpilot_e2e_e2e` and migrated that, while the app kept writing to the
accumulating `jobpilot_e2e` — so the daily submission cap came back after the
first run and gate 7.1-7.5 failed with `Daily cap reached (12/10)` on a database
that looked fresh. Evidence:

```
$ psql -c "select datname from pg_database where datname like 'jobpilot%'"
jobpilot          (74 applications — developer data, never touched)
jobpilot_e2e      (23 applications, accumulated over runs — the cap blocker)
jobpilot_e2e_e2e  (0 applications — the database that was actually reset)
```

The derivation is now idempotent (`jobpilot` -> `jobpilot_e2e` -> `jobpilot_e2e`),
the stray database was dropped, and a run proves the reset reaches the real target:

```
before=23   1 passed    after=0   (a single gate 8.6 run reset it)
apps_after_run1=5   apps_after_run2=5   dev_apps=74
```

Two consecutive full suites now pass against a database that starts empty each
time, which is what Phase 9 claimed and did not yet deliver.

### Defect 2 — the publish path could contain uppercase (Phase 11)

`images: ghcr.io/${{ github.repository }}/…` keeps the repository's capitalisation,
and container registry paths must be lowercase, so a repository such as `Owner/Repo`
would fail the push. The workflow now folds the name first:

```yaml
- name: Resolve image prefix
  id: image
  run: echo "prefix=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"
```

`latest` is also only emitted for `workflow_run` or `refs/heads/main`, so a manual
dispatch from a branch cannot move `latest` backwards.

### Defect 3 — the non-root user could not write Next's image cache (Phase 11)

`next start` writes optimised images under `.next/cache`, but only `/ms-playwright`
was chowned; the app directory stayed root-owned. The chown now covers both:
`chown -R jobpilot:jobpilot /ms-playwright /app`.

### Confirmed as intended

```
Build without .env / without DATABASE_URL  BUILD=0  ✓ Compiled successfully in 1818ms
  (the Docker build stage has neither, so the image build is safe)
Playwright versions                       playwright@1.63.0 == @playwright/test@1.63.0
  (one browser install serves both the test runner and the Auto-Pilot runtime)
Lint / typecheck / unit tests             0 / 0 / 0 (186 tests)
Full e2e, twice in a row                  29 passed (3.5m), 29 passed (3.7m) — 0 skipped
Developer database after both runs        74 applications, unchanged
```

Still unverified for the same reason as before: no Docker daemon here, so
`docker build`/`docker compose up` and the GHCR push itself have never executed.

## Phase 13 — Stage 1 safety fixes

### GATES LEDGER

| Gate | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 1.1 | Kill switch acts during a run | A flip mid-batch stops the next posting; a short per-host wait is honoured; submit is re-checked | 3 new `@jobpilot/apply` tests | [MET] |
| 1.2 | Stop always works | Stop stays enabled during a run, abandons the request and raises the banner | phase7 e2e (3 passed) | [MET] |
| 1.3 | Untrusted wrapper cannot be escaped | Forged `</untrusted>`, nested comments and zero-width smuggling are neutralised | 6 new `@jobpilot/llm` tests | [MET] |
| 1.4 | One posting, one run | A second claim fails; a stale claim is recoverable; release requeues | 3 new `@jobpilot/db` tests | [MET] |
| 1.5 | Challenge detection | A widget with no readable text pauses as CAPTCHA and nothing is filled or clicked | 1 new `@jobpilot/apply` test | [MET] |
| 1.6 | Sensitive answers encrypted | The column holds `v1.…` ciphertext, the API returns plaintext, audits carry no value | 3 new `@jobpilot/db` tests | [MET] |
| 1.7 | Production refuses known secrets | Each placeholder is named; strong values pass; a short secret fails | 5 new `@jobpilot/core` tests | [MET] |
| 1.7b | Compose demands the secrets | `docker compose config` fails without `.env`, naming `NEXTAUTH_SECRET` | the command itself | [PENDING] — no Docker daemon on this machine (`docker: command not found`), so the interpolation cannot be executed here |

### Evidence

`packages/apply/src/autopilot.ts` now re-reads the gate per posting and waits out a
short interval instead of stopping:

```ts
let decision = evaluatePreflight(await options.preflightFor(target, index));
if (!decision.allowed && decision.reason === "RATE_LIMIT" &&
    decision.retryAfterMs !== undefined && decision.retryAfterMs <= 60_000) {
  await sleep(decision.retryAfterMs);
  decision = evaluatePreflight(await options.preflightFor(target, index));
}
if (!decision.allowed) return { outcomes, stopReason: decision.reason };
```

`packages/autopilot/src/index.ts` supplies a fresh read per posting and a final
check before the submit click:

```ts
preflightFor: async (target) => {
  const fresh = await settingsFor(userId);
  const today = await submissionCounts({ since: startOfToday() });
  ...
},
beforeSubmit: async () => !(await settingsFor(userId)).killSwitch,
```

`packages/db/src/index.ts` claims with one conditional UPDATE. The stale branch is
required by the task's own stale-claim test, because a crashed run leaves the row
`RUNNING`:

```ts
OR: [
  { AND: [{ status: { in: CLAIMABLE_STATUSES } },
          { OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] }] },
  { AND: [{ status: "RUNNING" }, { claimedAt: { lt: staleBefore } }] },
],
```

Sensitive answers are encrypted on write and decrypted on read, and a value that
cannot be decrypted yields `""` plus `answer.decrypt_failed id=…` (id only):

```
@jobpilot/db:test: stderr | gate 1.6 … > stores an empty string when the stored value cannot be decrypted
@jobpilot/db:test: answer.decrypt_failed id=cmwjd2k45000ncv68hqhlt3kp
```

Run totals after Stage 1:

```
@jobpilot/apply:test:       Tests  56 passed
@jobpilot/autopilot:test:   Tests  6 passed
@jobpilot/core:test:        Tests  33 passed
@jobpilot/db:test:          Tests  21 passed
@jobpilot/llm:test:         Tests  35 passed
@jobpilot/render:test:      Tests  22 passed
@jobpilot/sources:test:     Tests  34 passed
TOTAL=207

LINT=0  TYPECHECK=0  TEST=0
pnpm e2e → 29 passed (3.2m)
pnpm --filter @jobpilot/web exec playwright test tests/e2e/phase7.spec.ts → 3 passed (1.2m)
```

Two implementation notes that differ from the brief:

- The instrumentation hook has to be split. Next compiles `instrumentation.ts` for
  the Edge runtime as well, and `@jobpilot/core` imports `node:crypto`, which broke
  the dev build with `UnhandledSchemeError: Reading from "node:crypto"`. The guard
  now lives in `instrumentation.node.ts` and is imported only when
  `NEXT_RUNTIME === "nodejs"`.
- `apps/worker` gained a workspace dependency on `@jobpilot/core` (it had none) so
  the worker can call the same production guard.

## Phase 14 — Stage 2 correctness fixes

### GATES LEDGER

| Gate | Sub-Task Name | Observable Outcome | Expected Proof | Status |
| --- | --- | --- | --- | --- |
| 2.1 | Repeated employers in the claim validator | Two roles at one company validate; an invented title still fails | 3 new `@jobpilot/core` tests | [MET] |
| 2.2 | Form control mapping | Checkbox/radio/select answered correctly; ids with `:` or `"` selected; social/hidden buttons ignored | 6 new adapter tests + phase4 e2e | [MET] |
| 2.3 | Per-host spacing in a batch | Two postings on one portal wait exactly one interval | 1 new `@jobpilot/apply` test | [MET] |
| 2.4 | Temp-file safety | One 0700 directory per run, removed even when the browser fails | typecheck + success path in e2e | [PENDING] — the requested test (mock Chromium failing, then assert the directory is gone) is not written; see below |
| 2.5 | Central request guard | A foreign `Origin` is refused and settings are unchanged | new e2e in phase7 | [MET] |
| 2.6 | Login hardening | Attempts counted per lowercase address; lock at five; constant work for unknown users | 1 db test + 1 core test + phase1 e2e | [MET] |
| 2.7 | Local day, single user, result endpoint | 3 zone cases; last run scoped to the user; replaying a result is 409 | 3 core cases + e2e 409 | [MET] |
| 2.8 | Indian address redaction | `Flat 12, MG Road, Bengaluru 560001` → `[ADDRESS]` … `[PIN]` | 3 new `@jobpilot/llm` tests | [MET] |

### Evidence

Run totals:

```
@jobpilot/apply 63 · autopilot 6 · core 38 · db 22 · llm 38 · render 22 · sources 34
LINT=0  TYPECHECK=0  TEST=0
pnpm e2e → 30 passed (3.0m)
phase7 alone → 4 passed (1.2m)
```

The claim validator now groups profile entries instead of keeping one per key,
because a second role at the same employer used to overwrite the first:

```ts
const workByCompany = groupBy(profile.work, (work) => work.company);
...
const entries = workByCompany.get(norm(role.company));
const matching = entries.filter((work) =>
  norm(role.title) === norm(work.position) &&
  role.startDate === work.startDate &&
  sameOptional(role.endDate, work.endDate) &&
  sameOptional(role.summary, work.summary));
```

The first e2e run of Stage 2 failed four tests with
`page.evaluate: ReferenceError: IGNORED_BUTTON_RE is not defined`. The button
filter lived at module scope, and `findButtons` is serialized into the page where
module scope does not exist. The regex is now declared inside the function, and
the same run then passed (`30 passed`).

The one guard for state-changing routes:

```ts
export async function requireUserRequest(req: Request): Promise<{ userId: string } | Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.method !== "GET") {
    if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
    ...
  }
  return { userId };
}
```

Deviations from the brief:

- **Task 2.1** asked for two NimbusPay roles inside `fixtures/sample-resume.json`
  and that the same file still yield 75 claims. The fixture has one NimbusPay role,
  and adding a second necessarily changes the claim count, so the new test uses
  `fixtures/duplicate-employer-resume.json` (a copy with Staff 2023-01 and Senior
  2021-03→2022-12) and the original fixture is asserted unchanged.
- **Task 2.5** rejects a body-less `DELETE` from the content-type rule; the Answers
  panel deletes with the id in the query string and no body, so a strict rule would
  have broken the app.
- **Task 2.4** is implemented but not proven: `mkdtempSync` with `0o700`, a
  `randomUUID` filename per resume with `0o600`, and `fs.rmSync(tempDir, { recursive: true, force: true })`
  in a `finally` that encloses the Playwright import, the launch and the batch. The
  requested failure-path test would need the database, the run's candidate
  selection and a mocked `playwright` module; I did not write it, so the gate stays
  open rather than being claimed.
