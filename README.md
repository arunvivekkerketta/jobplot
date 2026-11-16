# JobPilot

Job-application copilot with a deterministic Fact Index and a watermark-guarded
apply pipeline. This repository currently contains **Phase 1 — foundation and
master profile** (authentication, profile import, the Fact Index, settings and
the audit trail), **Phase 2 — document rendering** (HTML, PDF and DOCX resumes
that are claim-validated against the Fact Index, ATS lint, and the Documents
UI/API), and **Phase 3 — job sources** (Greenhouse, Lever, Ashby and Adzuna
adapters, paste-and-import, canonical-URL dedupe and the scheduled
`fetch-sources` queue), **Phase 4 — application executor** (canonical field
mapping, the Answer Bank resolver, the stop gate and a browser runner proven
against the mock ATS), **Phase 5 — matching** (deterministic scores with a
threshold gate, redacted explanations and pgvector embeddings), **Phase 6 —
tailoring** (fact-only resume selection with a keyword loop, explicit approval
before applying, and Answer Bank CRUD) and **Phase 7 — Auto-Pilot** (per-portal
unlock, a queue decided before any browser opens, daily and per-portal caps, and a
kill switch that stops a batch mid-run) and **Phase 8 — scheduled Auto-Pilot** (an
`autopilot-tick` cron in the worker that runs the same Auto-Pilot service as the
Run button, spending at most one submission per opted-in user per tick; set
`AUTOPILOT_CRON` to change the cadence). The rules every phase must follow live in
`CLAUDE.md`.

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
| `pnpm test` | vitest unit tests (core, llm, db, render, sources, web) |
| `pnpm test:integration` | Gate 2.4 against `<your database>_e2e` |
| `pnpm e2e` | Playwright against its own database on :3100 |
| `pnpm db:migrate` | Apply committed Prisma migrations |
| `pnpm db:seed` | Upsert the admin user and default Settings |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:studio` | Prisma Studio |

`pnpm e2e` never touches your development database. Playwright starts `next dev` on
:3100 against `<your database>_e2e`, and `apps/web/scripts/e2e-db.mjs` drops,
migrates and re-seeds that database before every run — so the daily submission cap
and every other counter start at zero and the suite is repeatable. Set
`E2E_DATABASE_URL` to point the suite at a different database, or `MOCK_ATS_URL`
if the mock ATS is not on :4600. The mock ATS is started (or reused) by the same
config.

The gate 2.4 test (`packages/autopilot/test/tempdir.integration.test.ts`) keeps a
real database and mocks only `playwright`, so it skips itself unless `DATABASE_URL`
names an `_e2e` database — that guard is what stops it writing rows into your own
data. `pnpm test:integration` is the way to run it: it creates `<database>_e2e` if
missing, applies the committed migrations, runs the test there, and exits non-zero
if the suite skipped instead of running, so a skipped proof cannot be mistaken for
a green one. CI runs the same command in the `checks` job.

GitHub Actions runs the same gates on every push to `main` and every pull request
(`.github/workflows/ci.yml`): a `pgvector/pgvector:pg16` service container, a
frozen-lockfile install, migrations plus seed, then `pnpm lint`, `pnpm typecheck`
and `pnpm test`; the e2e job adds Chromium and runs `pnpm e2e` against its own
`<database>_e2e`. Playwright traces are uploaded when the e2e job fails. No LLM key
is configured in CI, so the suites exercise the deterministic fallbacks.

## Containers and deploys

`Dockerfile` builds one workspace and exposes two targets that share the same
runtime — the web app and the queue worker import the same packages, and both need
Chromium for the Auto-Pilot executor:

```bash
docker build --target web    -t jobpilot-web    .
docker build --target worker -t jobpilot-worker .

docker run --rm -p 3000:3000 \
  -e DATABASE_URL=… -e APP_ENCRYPTION_KEY=… -e NEXTAUTH_SECRET=… \
  jobpilot-web
docker run --rm -e DATABASE_URL=… -e APP_ENCRYPTION_KEY=… jobpilot-worker
```

Migrations are not run on boot; apply them with the same image:
`docker run --rm -e DATABASE_URL=… jobpilot-web pnpm db:migrate`.

`.github/workflows/deploy.yml` publishes `ghcr.io/<owner>/<repo>/web` and
`…/worker` (long-sha and `latest` tags, GitHub Actions layer cache) only after the
CI workflow on `main` succeeds, or on a manual `workflow_dispatch`. It needs no
secrets: it authenticates to GHCR with the job's `GITHUB_TOKEN` and the workflow's
`packages: write` permission.

### Running the stack with compose

`docker-compose.yml` brings up the database, applies migrations once, and starts
both services only after that job succeeded and Postgres reported healthy:

```bash
docker compose up -d --build                  # build both images from this repo
docker compose up -d db                       # database only (dev setup)
docker compose --profile seed run --rm seed   # admin user + default Settings, once

docker compose ps                             # db/migrate exited 0, web + worker running
docker compose logs -f web worker
```

To run the images the deploy workflow published instead of building locally:

```bash
JOBPILOT_IMAGE_PREFIX=ghcr.io/<owner>/<repo> JOBPILOT_TAG=<commit-sha> \
  docker compose up -d
```

`migrate` runs `pnpm db:migrate` in the `web` image and exits; `web` and `worker`
declare `depends_on: migrate: condition: service_completed_successfully` plus
`db: condition: service_healthy`. Seeding is a separate `seed` profile because it
upserts the admin and resets `Settings` to the seed defaults. App configuration
comes from the environment or a local `.env`; the defaults in the file are the
throwaway development values, so set `APP_ENCRYPTION_KEY`, `NEXTAUTH_SECRET` and
`POSTGRES_PASSWORD` for anything real.

## Layout

```
apps/web        Next.js 15 App Router UI, Auth.js credentials login, API routes
apps/worker     pg-boss worker entrypoint
apps/mock-ats   Local mock applicant-tracking system used by apply tests
packages/core   Pure domain logic: crypto, profile schema, Fact Index, matching
packages/db     Prisma schema, migrations, audit, profile, job and match writes
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

All 15 Phase 1 gates, 9 Phase 2 gates, 18 Phase 3 gates, 10 Phase 4 gates, 10
Phase 5 gates, 8 Phase 6 gates and 8 Phase 7 gates are met; the exact commands and
outputs are recorded in [`docs/GATES.md`](docs/GATES.md). Job boards can be fetched in the
background and postings pasted by hand, an application can be filled and
submitted against the mock ATS behind the kill switch, caps, rate limit and
consent checks with every browser action audited, each posting is scored,
explained and embedded so the threshold decides what is eligible to apply, and a
resume can be tailored to a posting from the profile's own facts, reviewed,
approved by hand and only then attached to an application, and an unlocked portal
can submit qualifying applications unattended until a cap or the kill switch stops
it.

## Single-user by design

JobPilot runs for **one admin user**. The account is created by `pnpm db:seed`
from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, applications are unique per posting, and the
daily submission cap is global rather than per user. Multi-user support is not
implemented: there is no sign-up, no user switcher and no per-user isolation
beyond the `userId` columns every query already filters on. Treat the deployment
as a personal tool, not as a shared service.
