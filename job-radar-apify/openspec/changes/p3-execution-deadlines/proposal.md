# P3 — Duración, cancelación y cadencia

**Estado:** borrador de propuesta. Requiere aprobación + `design.md` +
`tasks.md` + spec delta antes de implementar (próxima sesión).

## Problema

- Los timeouts del tick (`scripts/run-scrape-tick.ts`) usan
  `Promise.race`: el rol o catálogo "vencido" sigue scrapeando y guardando
  en segundo plano, consumiendo presupuesto y conexiones hasta el cierre.
  Desde P2 esto es visible: esos intentos quedan `timeout /
  deadline_exceeded` en `source_attempts`, pero el trabajo no se cancela.
- Ninguna solicitud de red recibe `AbortSignal`; `executeWithResilience`
  espera reintentos (1 s/3 s/9 s) aunque el plazo global ya no alcance.
- Workflows en Node 20 con `npm ci || npm install` silencioso; la app
  declara Node `24.18.0`.
- GitHub documenta que el cron de Actions puede retrasarse o perderse; la
  cadencia (`role_source_runs`) no tiene reclamación atómica ni lease, así
  que dos ticks solapados pueden tomar el mismo rol/fuente.
- El enriquecimiento de detalle comparte el camino crítico del listado.

## Objetivo

Plazos efectivos: al vencer, el trabajo se cancela de verdad, lo ya
guardado persiste, y el siguiente tick retoma sin duplicar efectos.

## Alcance propuesto

- Runtime alineado (Node 24 en workflows) e instalación reproducible
  (`npm ci` sin fallback silencioso).
- `FetchContext` mínimo: `AbortSignal` + deadline propagados a
  `adapter.fetch`, `fetchDetail`, `executeWithResilience` y esperas.
- Presupuesto comprobado antes de cada fuente/página/lote/reintento.
- Reclamación atómica de rol/fuente con lease y latido (reutilizando el
  latido de `scrape_runs` de P2 cuando aplique), liberación ante fallo.
- CO/VE aislados; enriquecimiento fuera del camino crítico (cola real en
  P6; aquí solo desacoplar el plazo).

## Contratos involucrados

`FetchContext` (tabla de contratos en `docs/PROD-IMPROVEMENTS-PLAN.md`).
Base: `RunRecorder` / `source_attempts` de P2 para medir antes/después.

## Gates

- Cancelación comprobada: tras el plazo no quedan solicitudes ni
  escrituras del trabajo cancelado.
- Recuperación sin efectos duplicados con ticks solapados.
- Sin pérdida de vacantes ya guardadas; P2 sigue clasificando todos los
  intentos.

## Pendiente de diseñar

- Forma exacta de `FetchContext` y adopción gradual por adaptador.
- Esquema del lease (tabla nueva vs. columnas en `role_source_runs`).
- Si persiste la pérdida de crons: coste/aprobación de scheduler gestionado.
