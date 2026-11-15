# syntax=docker/dockerfile:1.7
#
# One build, two runtimes. The web app and the worker import the same workspace
# packages (db, apply, autopilot, sources), so they share a single build stage and
# a single runtime stage; the targets differ only in what they start:
#
#   docker build --target web    -t jobpilot-web    .
#   docker build --target worker -t jobpilot-worker .
#
# Both need Chromium: the Auto-Pilot executor drives a real browser from the API
# route (on-demand run) and from the worker (scheduled tick).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# packageManager pins pnpm 10.34.5 in package.json; corepack honours that pin.
RUN corepack enable
WORKDIR /app

FROM base AS build
# Browsers are installed in the runtime stage, not while resolving packages.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CI=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @jobpilot/web build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build /app /app
# `--with-deps` pulls the shared libraries Chromium needs; it runs as root before
# the unprivileged user is created. The workspace package that depends on
# playwright owns the binary, so its scope runs the CLI.
RUN pnpm --filter @jobpilot/autopilot exec playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin jobpilot \
    && chown -R jobpilot:jobpilot /ms-playwright
USER jobpilot
EXPOSE 3000

FROM runtime AS web
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["pnpm", "--filter", "@jobpilot/web", "start"]

FROM runtime AS worker
CMD ["pnpm", "--filter", "@jobpilot/worker", "start"]
