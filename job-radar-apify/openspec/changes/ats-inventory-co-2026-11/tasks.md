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
- [x] Corrida en producción: tamaño del inventario por fuente y por ATS. [Dry-run 40591248620](https://github.com/Yosmanovallos/Job-finder/actions/runs/40591248620) (solo lectura, tabla aún sin crear, 13 min, `--cc-max-pages 3`): **5.179 tableros distintos**.
  - Por fuente: Common Crawl 5.168, site-probe 9, enlaces en vacantes 2 (solo 4 URLs de ATS en vacantes vigentes: las bolsas casi nunca enlazan al ATS).
  - Por ATS: Greenhouse 2.292, Ashby 1.055, Workday 736, Teamtailor 568, SmartRecruiters 520, Lever 2, SuccessFactors 2, Magneto 2, Buk 1, Gupy 1.
  - Estado inicial: 5.145 `pending`, 30 `owned` (ya en `employer_sources`), 4 `unsupported_ats`.
  - Todos los patrones de Common Crawl respondieron; Lever trajo solo 72 URLs y `boards.greenhouse.io` 77 (el índice casi no los cubre, como anotaba ADR 0006 §7). Con 3 páginas por patrón el inventario es parcial: subir `--cc-max-pages` se mide en I2 contra el plazo.
- [x] Aplicado en producción desde `main` (`c724483`) con aprobación del dueño, tras integrar #61 y #62:
  - [migrate-dry-run 40593778981](https://github.com/Yosmanovallos/Job-finder/actions/runs/40593778981): solo crearía `ats_board_inventory`. [migrate 40593864148](https://github.com/Yosmanovallos/Job-finder/actions/runs/40593864148): tabla creada, RLS activo, 0 permisos para `anon`/`authenticated`.
  - [ats-inventory 40593946935](https://github.com/Yosmanovallos/Job-finder/actions/runs/40593946935): **4.255 filas nuevas**, ninguna habilitada. Greenhouse 1.335, Workday 1.181, Ashby 1.055, SmartRecruiters 520, Teamtailor 156, otros 8. Estado: 4.220 `pending`, 31 `owned`, 4 `unsupported_ats`.
  - El índice de Common Crawl no devuelve lo mismo en cada corrida (Workday salió de CC-MAIN-2026-34 porque el crawl 43 no respondió; Teamtailor trajo 4.372 URLs frente a 12.163 del dry-run). El insert-only acumula: cada corrida suma tableros sin borrar los anteriores.
  - [db-size 40595693262](https://github.com/Yosmanovallos/Job-finder/actions/runs/40595693262): 416 MB (antes 415 MB); `ats_board_inventory` 1,3 MB.

## I2 — sondeo y habilitación automática

- [x] Pruebas: reglas INV-010…INV-014, conflictos de dueño, agencia, ATS sin nombre, listado incompleto (`tests/validate-direct-inventory-probe.test.ts`, offline); integración en Postgres desechable: insert-only, idempotente, guarda de estado, dry-run sin escrituras, `jobs` y `employer_discovery` intactas (`tests/validate-direct-inventory-probe.ts`).
- [x] Sondeo del inventario en el descubrimiento programado, antes de la vía por nombre (INV-025), con `--max-enable` 25 (`scripts/direct-ats-probe.ts`, dry-run por defecto). Mismo horario y `timeout-minutes: 20`; el plazo se reparte 6 min inventario + 9 min vía por nombre (antes 12). Modos manuales `ats-probe-dry-run` / `ats-probe` en el tick.
  - Reglas: el nombre sale del ATS (Greenhouse `/v1/boards/{token}`, SmartRecruiters `company.name`, Teamtailor `channel/title`, Workday `hiringOrganization` del detalle); Lever, Ashby, Phenom, SuccessFactors y Eightfold no declaran nombre → `ambiguous`; Magneto → `ambiguous` (también es bolsa). Varios nombres en un tablero → `ambiguous`.
  - 401/403/429 y robots.txt → `blocked`; 5xx, forma inesperada, páginas incompletas o Workday con detalles sin leer y 0 en Colombia → `error`. Un 404 queda `error` con motivo "tablero inexistente" y reintento a 30 días (no hay estado `not_found` en INV-014).
  - Backoff: `error`/`blocked` 1, 2, 4… hasta 14 días; `no_colombia` se revisa a los 30 días; `enabled`, `owned`, `agency` y `ambiguous` son finales. Las decisiones finales nunca se sobrescriben (guarda en SQL).
  - Conflictos (INV-012) → `ambiguous`: la clave ya tiene un tablero del mismo ATS (aunque esté apagado), varias empresas con la clave, empresa rechazada en revisión humana, slug de otra empresa, o dos tableros del mismo ATS con la misma empresa en la corrida. Un tablero que ya está en `employer_sources` → `owned`. La promoción va de a una, con `pg_advisory_xact_lock` por clave.
  - Reversión: no hay comando todavía; `enabled = false` por `discovery_origin = 'ats_inventory'` (diseño §8) queda pendiente.
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
