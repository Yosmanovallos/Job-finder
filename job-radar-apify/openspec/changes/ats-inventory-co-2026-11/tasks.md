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
  - Reglas: el nombre sale del ATS (Greenhouse `/v1/boards/{token}`, SmartRecruiters `company.name`, Teamtailor `channel/title`, Workday `hiringOrganization` del detalle); Lever, Ashby, Phenom, SuccessFactors y Eightfold no declaran nombre → `ambiguous`; Magneto → `ambiguous` (también es bolsa). Varios nombres en un tablero, un nombre que es etiqueta del tablero ("External Website", "Careers", "Client Roles"…), un código interno de entidad delante del nombre (Workday) o un ref de prueba (`thltestcareers`) → `ambiguous`.
  - 401/403/429 y robots.txt → `blocked`; 5xx, forma inesperada, páginas incompletas o Workday con detalles sin leer y 0 en Colombia → `error`. Un 404 queda `error` con motivo "tablero inexistente" y reintento a 30 días (no hay estado `not_found` en INV-014).
  - Backoff: `error`/`blocked` 1, 2, 4… hasta 14 días; `no_colombia` se revisa a los 30 días; `enabled`, `owned`, `agency` y `ambiguous` son finales. Las decisiones finales nunca se sobrescriben (guarda en SQL).
  - Conflictos (INV-012) → `ambiguous`: la clave ya tiene un tablero del mismo ATS (aunque esté apagado), varias empresas con la clave, empresa rechazada en revisión humana, slug de otra empresa, o dos tableros del mismo ATS con la misma empresa en la corrida. Un tablero que ya está en `employer_sources` → `owned`. La promoción va de a una, con `pg_advisory_xact_lock` por clave.
  - Reversión (diseño §8): `scripts/direct-ats-inventory-review.ts revert <ats:ref|all>` con `--dry-run`; apaga en `employer_sources` los tableros que habilitó el inventario y deja su fila en `ambiguous` con el motivo (ningún sondeo los reactiva). No borra empresas, alias ni vacantes; la proyección retira las filas del tablero apagado como con cualquier tablero. Modos `inventory-revert-dry-run` / `inventory-revert` en el tick.
- [x] Corrida `dry-run` en producción (solo lectura, desde la rama del PR) y revisión de la muestra:
  - [Dry-run 40598652308](https://github.com/Yosmanovallos/Job-finder/actions/runs/40598652308) (`--limit 1500`): 1.500 filas en 40 s. La muestra mostró nombres de tablero de Greenhouse que son etiquetas ("Backblaze External Website"); se añadió la regla de etiqueta → `ambiguous`.
  - [Dry-run 40598927265](https://github.com/Yosmanovallos/Job-finder/actions/runs/40598927265): la muestra mostró "Extenteam Client Roles" (tablero para clientes de una firma de personal); "client(s)" pasa a la regla de etiqueta.
  - [Dry-run 40601010034](https://github.com/Yosmanovallos/Job-finder/actions/runs/40601010034): la muestra mostró nombres de Workday con un código interno de entidad delante ("1838 AIRBUS COLOMBIA SAS", "6000 AstraZeneca Colombia S.A.S.") y un tablero de prueba (`greenhouse:thltestcareers`). Cortar el código sería adivinar ("3M Colombia" empieza igual): ambos casos pasan a `ambiguous`.
  - **[Dry-run 40603351531](https://github.com/Yosmanovallos/Job-finder/actions/runs/40603351531) con las reglas finales** (`--limit 5000 --deadline-min 15`, nada escrito): **3.381 de 4.220 pendientes sondeados**; el plazo dejó 839 para la próxima corrida (Workday es el lento: robots + pausas + detalle). No es el 100 %: la clasificación completa llega con las corridas programadas.
    - Por estado: `no_colombia` 3.062 · `error` 229 · `blocked` 32 · `ambiguous` 28 · `enabled` 25 (tope) · 5 elegibles más sobre el tope, quedarían `pending`.
    - Por ATS: Ashby 1.008 sin Colombia / 13 ambiguous (no declara nombre: Nubank, Kraken, Hostinger…) / 29 error (casi todos 404); Greenhouse 1.293 / 11 enabled / 7 ambiguous / 17 error; SmartRecruiters 492 / 14 enabled / 1 ambiguous / 3 sobre el tope; Teamtailor 152 / 3 error / 1 sobre el tope; Workday 115 sin Colombia / 32 blocked (robots.txt) / 176 error (detalles sin leer con 0 en Colombia, HTTP 500/422) / 7 ambiguous (códigos de entidad, varias razones sociales) / 1 sobre el tope; Magneto 2 error (listado incompleto); Lever 1 / 1 error.
    - Se habilitarían: Greenhouse Acumen, Alarm.com, Alphalion, Aspenview Technology Partners, Atlas HXM, Brandtech+, Cobre, Encora, Exadel, Goods & Services, Power Digital; SmartRecruiters AbbVie, AccorCorpo, AECOM, Blend360, Dr Reddy's, Exit83, H&M Group, Inetum, Lifted (an Upwork Company), Miratech, NBCUniversal, Red Bull, Sika, Syngenta. Sobre el tope (siguiente corrida): UPROSPECT, Veolia, Wise, TOPPAN Security, Brenntag Colombia.
    - Para decidir el dueño: "Lifted, an Upwork Company" puede publicar puestos de clientes (la propuesta deja Upwork fuera); la lista de agencias es curada a mano, así que no se añadió sin su decisión.
  - Pendiente para fases siguientes: (1) empleadores duplicados por claves distintas ("H&M Group" → `hmgroup` frente a un `hm` existente) — el dedupe de I3 agrupa por `employer_id`, así que debe cubrirlo; (2) ~~vía de revisión humana de los `ambiguous`~~ y (3) ~~comando de reversión~~: hechos después del merge (ver abajo).
- [x] `execute` en producción: el dueño aprobó el merge de #68 (2026-10-27), que activa el sondeo con escritura en las corridas programadas del descubrimiento.
  - Primeras corridas programadas con `195cb21`: [40668283871](https://github.com/Yosmanovallos/Job-finder/actions/runs/40668283871) y [40734153123](https://github.com/Yosmanovallos/Job-finder/actions/runs/40734153123) (2026-10-28). **0 habilitados**: con `--limit 500`, las dos gastaron el presupuesto en tableros de Ashby (1.000 filas: 959 `no_colombia`, 29 `error`, 12 `ambiguous`), que nunca declaran nombre. El paso tardó 23 s de sus 6 min; la vía por nombre siguió igual (15 y 3 candidatos vencidos, como antes del merge).
  - Inventario tras esas corridas: 3.220 `pending` · 959 `no_colombia` · 31 `owned` · 29 `error` · 12 `ambiguous` · 4 `unsupported_ats`.
  - Corrección: `pickDueInventory` ordena primero los ATS que pueden declarar nombre (Greenhouse, SmartRecruiters, Teamtailor, Workday); prueba de integración del orden.
  - [db-size 40775551199](https://github.com/Yosmanovallos/Job-finder/actions/runs/40775551199) (2026-10-28, solo lectura): 418 MB (antes 416 MB); `ats_board_inventory` 1,5 MB; `employer_sources` 110 filas; `direct_jobs` 1.575 filas, 6,7 MB. Lejos del límite de 8 GB (INV-043).
  - [Lista de revisión 40775547666](https://github.com/Yosmanovallos/Job-finder/actions/runs/40775547666) (solo lectura, desde la rama): 12 `ambiguous`, todos de Ashby por no declarar nombre: kraken.com 18/88 CO, nubank 6/97, Owner 5/53, constructor 3/34, veho-tech-inc 3/56, agent 2/16, palo-it 2/36, the-global-talent-co 2/28, arrive, go-nimbly, gratia, hostinger 1 cada uno. Habilitarlos requiere que una persona confirme el nombre (`inventory-approve`).
  - [Primera corrida programada con el orden corregido 40787260343](https://github.com/Yosmanovallos/Job-finder/actions/runs/40787260343) (2026-10-28 23:25 UTC, `a83f916`, `--execute --limit 500 --max-enable 25`): 500 tableros de Greenhouse (refs `1…` a `b…`, en orden alfabético) en 32 s de los 6 min. **6 habilitados**, los mismos que había anticipado el dry-run: Acumen 1/4 CO, Alarm.com 1/81, Alphalion 1/3, Aspenview Technology Partners 20/59, Atlas HXM 1/30, Brandtech+ 1/14. Además, 486 `no_colombia`, 7 `error` (5 con 404; `aloyoga` y `andurilindustries` por respuesta demasiado grande) y 1 `ambiguous` (`backblaze`, porque declara "Backblaze External Website"). La vía por nombre: 0 candidatos vencidos y 114 tableros habilitados en el tick (6 sin leer aún).
  - Inventario tras la corrida: 2.720 `pending` · 1.445 `no_colombia` · 36 `error` · 31 `owned` · 13 `ambiguous` · 6 `enabled` · 4 `unsupported_ats`.
  - Con `--limit 500`, cada corrida avanza ~500 filas, así que vaciar los 2.720 pendientes toma unas 6 corridas programadas. Los tableros con respuesta demasiado grande quedan en `error` con reintento escalonado; su tope de tamaño no se cambió.
- [x] Revisión humana de los `ambiguous` del inventario: `scripts/direct-ats-inventory-review.ts list` (solo lectura) y `approve <ats:ref>` con el nombre que da una persona (`REVIEW_NAME`). El tablero se vuelve a listar (completo, ≥ 1 vacante vigente en Colombia), se rechazan nombres de agencia, genéricos o de relleno y la promoción es la misma insert-only con sus conflictos. Modos `inventory-review-list` / `inventory-approve-dry-run` / `inventory-approve` en el tick.
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
