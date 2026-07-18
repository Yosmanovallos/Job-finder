# job-radar-local

Local-first job radar. Full specification lives in
[`PLAN_RADAR_EMPLEO_LOCAL.md`](./PLAN_RADAR_EMPLEO_LOCAL.md); the build
walkthrough is in
[`GUIA_PASO_A_PASO_RADAR_EMPLEO_LOCAL.md`](./GUIA_PASO_A_PASO_RADAR_EMPLEO_LOCAL.md).

Status: **MVP completo (Fases 0–6, 8, 9)** — auditoría de release aprobada el
2026-07-18 (`docs/release/2026-07-18-audit.md`). Conectores Greenhouse, Lever,
Ashby y SmartRecruiters; pipeline idempotente con dedupe por capas y
verificación de vigencia; matching determinista con evals; gateway LLM con
presupuestos (prompts inactivos hasta pasar gates reales); proyección a Notion
dry-run-first; candidatura asistida **sin auto-apply**.

## Setup

```bash
pnpm install
cp .env.example .env
cp config/profile.example.yaml config/profile.local.yaml   # edita tu perfil
docker compose up -d postgres
pnpm db:migrate
```

## Daily flow

```bash
pnpm source:health --all
pnpm ingest                    # descubre, extrae, dedupe, versiona
pnpm verify --due              # vigencia (2 señales negativas para cerrar)
pnpm match                     # scoring determinista, sin LLM
pnpm notion:sync --dry-run     # revisa el plan; --execute para escribir
pnpm apply:prepare --job <id>  # borradores con evidencia; aprobación humana
```

## Verify

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm eval:matching             # baseline: precision@10 = 1.0
```

## Layout

```text
apps/cli               CLI completa (ingest/verify/match/notion/apply/...)
packages/domain        esquemas perfil / hechos CV / vacante canónica
packages/sources       contrato SourceAdapter + 4 conectores ATS
packages/dedupe        normalización URL, claves, simhash, merge
packages/ingestion     pipeline de ingesta + circuit breaker
packages/matching      scoring determinista + evals
packages/models        gateway LLM, prompts versionados (inactivos), budgets
packages/notion        proyección Notion (sync/pull/reconcile/DLQ)
packages/application   candidatura asistida, factuality validator, no auto-apply
packages/config        env loader validado con Zod
packages/db            esquema Drizzle + migraciones + cliente Postgres
packages/observability logger estructurado Pino
docs/adr/              decisiones de arquitectura
docs/release/          auditorías de release
```

See `AGENTS.md` for rules that apply to any agent (human or AI) working in
this repo.
