# job-radar-local

Local-first job radar. Full specification lives in
[`PLAN_RADAR_EMPLEO_LOCAL.md`](./PLAN_RADAR_EMPLEO_LOCAL.md); the build
walkthrough is in
[`GUIA_PASO_A_PASO_RADAR_EMPLEO_LOCAL.md`](./GUIA_PASO_A_PASO_RADAR_EMPLEO_LOCAL.md).

Status: **Fase 0 — bootstrap**. Only the monorepo skeleton, config loader,
logger, minimal DB schema and an empty CLI exist so far. No connectors, no
Notion sync, no LLM calls.

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:generate   # first time only, or after schema.ts changes
pnpm db:migrate
```

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @job-radar/cli start db:status
```

## Layout

```text
apps/cli          empty CLI (db:status for now)
packages/config    Zod-validated env loader
packages/db        Drizzle schema + migrations + Postgres client
packages/observability  Pino structured logger
docs/adr/          architecture decisions
```

See `AGENTS.md` for rules that apply to any agent (human or AI) working in
this repo.
