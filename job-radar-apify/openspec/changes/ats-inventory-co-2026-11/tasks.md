# Tareas — una subfase por sesión, cada una con PR, CI verde y evidencia

## I0 — línea base y decisión (esta sesión)

- [x] Medir cobertura y censo de Computrabajo en producción (corridas 40579329181 y 40584309357).
- [x] Registrar decisiones del dueño: `Internacional`, habilitación automática, costo cero adicional, sin duplicados, prioridad oficial.
- [x] Enmienda §13 del ADR 0006.
- [x] Medir `db-size` y throughput actual del tick como línea base de costo:
  - [db-size 40587905336](https://github.com/Yosmanovallos/Job-finder/actions/runs/40587905336): 415 MB de los 8 GB del plan Pro (`docs/direct/baseline-2026-10-20.md`). `direct_jobs` 1.482 filas, 6,3 MB (~4,3 kB por fila); `employer_discovery` 10.060 filas, 7 MB.
  - Tick programado ([40569371808](https://github.com/Yosmanovallos/Job-finder/actions/runs/40569371808) y anteriores): 106–107 tableros por corrida, ~6 min de job con plazo de 14 min.
  - Las corridas programadas del 26 y 27 de octubre arrancaron con 3 a 7 h de separación, aunque el cron es horario. A eso se suma `MIN_INTERVAL_HOURS = 5`.

## I1 — inventario (solo lectura sobre producción, escribe solo `ats_board_inventory`)

- [x] Pruebas que fallan primero: normalizador único, refs canónicas, adversariales, idempotencia, "sin datos" de Common Crawl (`tests/validate-direct-inventory.test.ts`, INV-001…INV-006).
- [x] Bloque aditivo `direct-inventory` en `migrate-direct-employers.ts` (con `--dry-run`); RLS + `REVOKE`; integración en Postgres desechable (`tests/validate-direct-inventory.ts`).
- [x] Un solo normalizador para todas las fuentes; Common Crawl para los conectores con ref en la URL; refs de vacantes vigentes (filtradas en SQL) y de la evidencia del `site-probe`.
- [x] Modos `ats-inventory-dry-run` y `ats-inventory` en `direct-employers-tick.yml`; el dry-run funciona sin la tabla.
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
