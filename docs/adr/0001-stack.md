# ADR-001: Stack and monorepo shape for job-radar-local

- Status: accepted
- Date: 2026-07-17

## Context

`PLAN_RADAR_EMPLEO_LOCAL.md` section 3 specifies the recommended stack for
the MVP. This ADR records the concrete choice made for Fase 0 so future
phases don't re-litigate it without cause.

## Decision

- **Monorepo**: pnpm workspaces, TypeScript throughout, `strict: true` plus
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Runtime**: Node.js 22+ (LTS), ESM (`"type": "module"` everywhere).
- **Validation**: Zod for env, config, and (from Fase 1) domain schemas.
- **Database**: PostgreSQL 16 via the `pgvector/pgvector:pg16` image, so
  the vector extension ships with the base image instead of being installed
  separately.
- **ORM**: Drizzle ORM + drizzle-kit for migrations, `postgres` (postgres.js)
  as the driver.
- **Logging**: Pino, JSON structured, with a default redact list for PII
  field names (email, phone, tokens, cookies, HTML/CV bodies).
- **CLI**: Commander.
- **Tests**: Vitest, one `*.test.ts` colocated per source file.
- **Lint/format**: ESLint flat config (`typescript-eslint` recommended) +
  Prettier, wired into a `PostToolUse` hook via `.claude/settings.json`.
- **Containers**: Docker Compose, `postgres` service only in Fase 0. `api`,
  `worker`, `scheduler`, `mcp-server`, `ollama`, `playwright-worker` are
  added when the phase that needs them starts — not scaffolded empty.
- **Modular monolith**: no microservices split in the MVP (plan 3.2).

## Consequences

- Every new package gets its own `package.json` + `tsconfig.json`
  (`composite: true`, extending `tsconfig.base.json`) so `tsc -b` builds the
  workspace incrementally and in dependency order.
- `packages/db` is intentionally decoupled from `packages/config` — it
  takes a connection string as a parameter rather than reading `process.env`
  itself, so it stays testable and reusable outside the CLI.
- Only `packages/config`, `packages/observability`, `packages/db`, and
  `apps/cli` exist after Fase 0. The full target tree in plan section 5
  (sources, ingestion, matching, notion, prompts, evals, ...) is added
  incrementally, one phase at a time, per the plan's fundamental rule
  against implementing ahead of the approved phase.

## Alternatives considered

- **Redis + BullMQ** for queueing: rejected for the MVP per plan 3.1, which
  prefers `pg-boss` to avoid an extra infrastructure dependency. Not needed
  until Fase 2+ (discovery loop).
- **Microservices** from day one: rejected per plan 3.2 — the personal-use
  volume doesn't justify the operational cost; module boundaries are kept
  clean enough to split later if needed.
