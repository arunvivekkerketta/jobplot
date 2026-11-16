# Baseline before the fix-and-improve pass

Recorded at the start of Stage 0, **before** any task from the fix list changed
behaviour. Everything below exited 0.

## Environment

- Windows 11, Node 22, pnpm 10.34.5, turbo.
- Postgres 16 with pgvector running locally on `127.0.0.1:55432` (data dir `.pgdata`).
- Deviation from Task 0.2: this machine has **no Docker daemon** (`docker` is not
  installed), so `docker compose up -d db` is impossible. The existing local
  Postgres was started with `pg_ctl` instead. Every Docker-dependent check in this
  pass is reported as unverifiable rather than as passing.

## Commands

### `pnpm db:migrate`

```
2 migrations found in prisma/migrations

No pending migrations to apply.
```

### `pnpm db:seed`

```
Seeded admin admin@jobpilot.local with default Settings: mode COPILOT, dailyCap 10, matchThreshold 75, killSwitch false, allowSubmit false
```

### `pnpm lint`

```
Warning: React version was set to "detect" in eslint-plugin-react settings, but the "react" package is not installed. Assuming latest React version for linting.
Pages directory cannot be found at ...\jobplot\pages or ...\jobplot\src\pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.
```

Exit 0, 0 errors, 0 warnings from the project's own rules (the two lines above are
eslint-plugin-next configuration notices, not violations).

### `pnpm typecheck`

```
 Tasks:    10 successful, 10 total
  Time:    55ms >>> FULL TURBO
```

### `pnpm test`

```
@jobpilot/apply:test:       Tests  52 passed (52)
@jobpilot/render:test:      Tests  22 passed (22)
@jobpilot/llm:test:         Tests  29 passed (29)
@jobpilot/core:test:        Tests  28 passed (28)
@jobpilot/db:test:          Tests  15 passed (15)
@jobpilot/autopilot:test:   Tests  6 passed (6)
@jobpilot/sources:test:     Tests  34 passed (34)
```

186 tests, 0 failures.

### `pnpm e2e`

```
  29 passed (3.1m)
```

0 skipped, run against the isolated `jobpilot_e2e` database.

## Notes carried forward

- `prisma generate` already succeeds with `DATABASE_URL` unset on Prisma 6.19.3, so
  Task 0.1's reported failure ("a fresh clone or docker build fails") is not
  reproducible on this repository. The wrapper script was still added exactly as
  specified, as defensive hardening; see the Stage 0 report.
- `mock-ats.log` was committed in the initial project import; it is removed from
  tracking in Task 0.3 and covered by the new `*.log` ignore rule.
