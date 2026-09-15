# P2 — Observabilidad real de ejecuciones y fuentes

**Estado:** ✅ aprobado e implementado (2026-09-15, commit `74bbe7a`).
Diseño en `design.md`, requisitos y resultados en
`specs/observability/spec.md`, ejecución en `tasks.md`. Texto original de
la propuesta conservado abajo; la sección final registra cómo se resolvió
lo que quedaba pendiente.

## Problema

`/api/runs` lee el historial del caché JSON local, no ejecuciones reales.
Un workflow verde en Actions no implica datos sanos: errores, bloqueos,
cuotas y falta de configuración terminan como "cero resultados"
indistinguibles de una fuente legítimamente vacía.

## Objetivo

Cada ejecución se puede seguir desde Actions hasta sus resultados por
fuente; los registros de prueba no aparecen como actividad productiva.

## Alcance propuesto

Persistir de forma aditiva:

- **Ejecución:** origen, SHA, país, inicio, heartbeat, final, resultado.
- **Intento por fuente:** listado, detalle o verificación.
- **Contadores:** recibidas, válidas, filtradas, nuevas, actualizadas,
  duplicadas, fallidas.
- Duración, bytes, solicitudes, motivo de cero resultados, coste si existe.
- Identificadores de Actions para correlación.

Estados explícitos: `success`, `empty`, `partial`, `timeout`, `blocked`,
`rate_limited`, `quota_exhausted`, `misconfigured`, `schema_changed`,
`skipped`.

Superficies:

- Evolucionar `/api/runs` conservando compatibilidad con consumidores.
- Vista administrativa paginada; resumen público solo seguro.
- Reconciliar ejecuciones interrumpidas/canceladas (un proceso muerto no
  escribe su propio resultado final).
- Un fallo de telemetría no debe perder vacantes ya guardadas.

## Contratos involucrados

`ScrapeRun`, `SourceAttempt` (ver tabla de contratos en
`docs/PROD-IMPROVEMENTS-PLAN.md`). Reutilizar estructuras existentes antes
de añadir tablas.

## Gates

- Todos los intentos clasificables con estado y motivo.
- Ejecuciones muertas reconciliadas (heartbeat expirado → `timeout`/dead).
- Ningún fallo presentado como éxito vacío.
- Migración aditiva; rollback sin pérdida de datos.
- Telemetría fallida no interrumpe persistencia de vacantes.

## Pendiente de diseñar → resuelto

- Esquema exacto de tablas/columnas (aditivo) → `scrape_runs` /
  `source_attempts`, bloque `p2-run-observability` de `schema.sql`
  (design.md, «Esquema»).
- Dónde se escriben los heartbeats y quién reconcilia → latido desde el
  propio proceso del tick (`RunRecorder`, 60 s); reconciliación al inicio
  de cada tick y derivación en lectura, sin proceso siempre vivo
  (design.md, «RunRecorder»; OBS-005). Una ejecución muerta queda
  `interrupted`, no `timeout`: `timeout` se reserva al plazo agotado.
- Contrato de respuesta de `/api/runs` → misma forma con campos aditivos,
  paginado, `503` ante fallo (OBS-008).
- Público vs. administración → público sin roles, SHA, Actions ni clases
  de error; detalle solo con `OPS_ADMIN_TOKEN` (OBS-008, OBS-009).
- Estados: `rate_limited`, `quota_exhausted` y `schema_changed` quedan
  reservados sin emisión en P2 por falta de señal fiable (OBS-004).
