# Tareas — una subfase por sesión, cada una con PR, CI verde y evidencia

## I0 — línea base y decisión (esta sesión)

- [x] Medir cobertura y censo de Computrabajo en producción (corridas 40579329181 y 40584309357).
- [x] Registrar decisiones del dueño: `Internacional`, habilitación automática, costo cero adicional, sin duplicados, prioridad oficial.
- [x] Enmienda §13 del ADR 0006.
- [ ] Medir `db-size` y throughput actual del tick (tableros por corrida, duración) como línea base de costo.

## I1 — inventario (solo lectura sobre producción, escribe solo `ats_board_inventory`)

- [ ] Pruebas que fallan primero: parsers de refs por ATS, normalización, adversariales (INV-001…INV-005).
- [ ] Migración aditiva con `--dry-run`; RLS + `REVOKE`.
- [ ] Ampliar `cc-refs.ts` a todos los ATS con conector; extraer refs de vacantes guardadas y del `site-probe`.
- [ ] Modo `ats-inventory` (dry-run por defecto) en el workflow existente.
- [ ] Corrida en producción: tamaño del inventario por fuente y por ATS.

## I2 — sondeo y habilitación automática

- [ ] Pruebas: reglas INV-010…INV-014, conflictos de dueño, agencia, ATS sin nombre, listado incompleto.
- [ ] Sondeo del inventario en el descubrimiento programado, antes de la vía por nombre (INV-025), con `--max-enable` 25.
- [ ] Corrida `dry-run` y revisión de la muestra; después `execute`.
- [ ] Reporte: filas por estado; 100 % clasificadas al terminar el inventario.

## I3 — sin duplicados y `Internacional`

- [ ] Pruebas: dedupe oficial-oficial, alias exacto y por enlace, `matchInternationalRemote` positivos y adversariales, exclusión del gate de Google.
- [ ] Enmienda de `matchColombia` sin romper su contrato; `scope` en `direct_jobs` (aditivo).
- [ ] Etiqueta `Internacional` en tarjeta y detalle, reutilizando badges existentes; verificación visual y medición en frío del dashboard según runbook.
- [ ] `duplicate-audit` en producción = 0.

## I4 — tick priorizado

- [ ] Pruebas: niveles A/B/C y backoff (INV-040).
- [ ] Orden por nivel en `run-direct-tick.ts`; mismo cron, timeout y plazo (INV-041).
- [ ] Reporte de ventanas: 100 % del nivel A dentro de 6 h; déficit publicado si no.

## Salida

- [ ] Lint de archivos tocados, TypeScript, build, unitarias e integración aislada en CI.
- [ ] Métricas de la propuesta cumplidas y registradas aquí; `db-size` después.
- [ ] Archivar este cambio y, aparte, `official-coverage-co-2026-10` (tareas completas).
