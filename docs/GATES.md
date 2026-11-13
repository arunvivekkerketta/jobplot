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
