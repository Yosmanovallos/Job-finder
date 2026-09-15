# P2 — Observabilidad real de ejecuciones y fuentes

**Estado:** borrador de propuesta. Requiere aprobación + `design.md` +
`tasks.md` + spec delta antes de implementar (próxima sesión).

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

## Pendiente de diseñar

- Esquema exacto de tablas/columnas (aditivo).
- Dónde se escriben los heartbeats y quién reconcilia.
- Contrato de respuesta de `/api/runs` (compatibilidad).
- Qué se expone públicamente vs. solo administración.
