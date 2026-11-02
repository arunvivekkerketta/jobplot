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
