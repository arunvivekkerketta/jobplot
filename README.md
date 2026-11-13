# JobPilot

Job-application copilot with a deterministic Fact Index and a watermark-guarded
apply pipeline. This repository currently contains **Phase 1 — foundation and
master profile** (authentication, profile import, the Fact Index, settings and
the audit trail), **Phase 2 — document rendering** (HTML, PDF and DOCX resumes
that are claim-validated against the Fact Index, ATS lint, and the Documents
UI/API), and **Phase 3 — job sources** (Greenhouse, Lever, Ashby and Adzuna
adapters, paste-and-import, canonical-URL dedupe and the scheduled
`fetch-sources` queue), and **Phase 4 — application executor** (canonical field
mapping, the Answer Bank resolver, the stop gate and a browser runner proven
against the mock ATS). Later phases add matching, tailoring and Auto-Pilot;
the rules every phase must follow live in `CLAUDE.md`.

## Requirements

- Node.js >= 20 and pnpm 10 (`packageManager` is pinned in `package.json`)
- PostgreSQL 16+ with the `vector` extension (the compose file uses
  `pgvector/pgvector:pg16`)

## Setup

```bash
pnpm install
cp .env.example .env         # fill ANTHROPIC_API_KEY, APP_ENCRYPTION_KEY, ADMIN_*
docker compose up -d         # Postgres + pgvector on localhost:5432
pnpm db:migrate              # apply prisma/migrations
pnpm db:seed                 # admin user + default Settings
pnpm dev                     # web on :3000, mock-ats on :4000
```

Sign in at <http://localhost:3000/login> with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
from `.env`.

The Prisma CLI runs from `packages/db`, so `packages/db/prisma.config.ts` loads
the single root `.env`; Next and the worker load it the same way. Every command
below therefore works from the repository root without exporting variables.

### Database without Docker

If Docker is unavailable, any local PostgreSQL with pgvector works — set
`DATABASE_URL` in `.env` to it and run `pnpm db:migrate && pnpm db:seed`. This
machine keeps a cluster in `.pgdata` (gitignored, port 55432) started with:

```bash
./.pg-install/bin/pg_ctl.exe -D .pgdata -o "-p 55432 -c listen_addresses=127.0.0.1" -l .pgdata/startup.log start
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run every app in watch mode through turbo |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | vitest unit tests (core, llm, db, render, sources) |
| `pnpm e2e` | Playwright against a dev server on :3000 |
| `pnpm db:migrate` | Apply committed Prisma migrations |
| `pnpm db:seed` | Upsert the admin user and default Settings |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:studio` | Prisma Studio |

`pnpm e2e` expects a migrated, seeded database; the Playwright config reuses an
already-running server or starts `next dev` itself.

## Layout

```
apps/web        Next.js 15 App Router UI, Auth.js credentials login, API routes
apps/worker     pg-boss worker entrypoint
apps/mock-ats   Local mock applicant-tracking system used by apply tests
packages/core   Pure domain logic: crypto, profile schema, Fact Index, aliases
packages/db     Prisma schema, migrations, seed, audit + profile persistence
packages/llm    Anthropic client with retry/repair/timeout, redaction, wrappers
packages/render HTML, PDF and DOCX resume rendering plus ATS lint
packages/sources Job-board adapters, canonical URLs, fetch-sources handler
packages/apply  Field mapper, stop gate and the Playwright-driven runner
fixtures/       Sample JSON Resume used by tests
docs/GATES.md   Phase gate ledger with evidence blocks
```

## Safety invariants

Generated content may only restate facts present in the Fact Index (I1); scraped
text is data, never instructions (I2); nothing is submitted without consent (I3)
and the kill switch, caps and rate limits are checked before every browser batch
(I4). Sensitive answers come only from the user's Answer Bank (I5), mock offers
carry a SAMPLE watermark (I6), sensitive fields are encrypted and redacted (I7),
and every LLM call, validation and browser action is audited (I8). These are
enforced in code, not just documented — see `CLAUDE.md` for the full protocol.

## Phase status

All 15 Phase 1 gates, 9 Phase 2 gates, 18 Phase 3 gates and 10 Phase 4 gates are
met; the exact commands and outputs are recorded in
[`docs/GATES.md`](docs/GATES.md). Job boards can be fetched in the background and
postings pasted by hand, and an application can be filled and submitted against
the mock ATS behind the kill switch, caps, rate limit and consent checks, with
every browser action audited.
