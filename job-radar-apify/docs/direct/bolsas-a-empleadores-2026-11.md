# Empresas de Indeed y Glassdoor → empleadores directos (2026-11-02)

Segunda vía para las empresas que aparecen en Indeed y Glassdoor. Los
adaptadores de esas bolsas **no cambian**: ni el código, ni la frecuencia,
ni la ventana (decisión del dueño, 2026-11-02). La vía adicional es la de
los portales oficiales (ADR 0006): si la empresa tiene tablero en un ATS
soportado, sus vacantes llegan completas, con fecha del ATS y aptas para
Google, sin pasar por Indeed ni Glassdoor.

## 1. Lo que ya existía

- La cola de descubrimiento (`employer_discovery`) ya se alimenta de
  **todas** las bolsas: `loadDirectoryCandidates` lee las filas vigentes de
  Colombia (o sin país) sin filtrar por fuente, y cada `discover` no-dry
  hace `syncCandidates`. Las empresas de Indeed/Glassdoor en Colombia ya
  entran a la cola.
- Lo que faltaba era **prioridad**: las tres corridas programadas del
  workflow `Direct Employers Discovery` usan `--focus-computrabajo`. Una
  empresa vista solo en Indeed o Glassdoor se sondeaba únicamente con un
  dispatch manual `focus=all`, mezclada con miles de empresas.

## 2. Diseño (sin pipeline paralelo)

| Pieza | Cambio |
|---|---|
| `src/db/direct-discovery-repository.ts` | `loadSourceCoverage(sources, country)` — censo de solo lectura (`READ ONLY`, `REPEATABLE READ`, 180 s) para cualquier bolsa: fuente primaria o conservada tras dedupe (`source = ANY($1) OR sources ?| $1`), por país (CO / VE / sin país), con tablero habilitado, vacantes oficiales vigentes, decisión y si la cola la elegiría ya (`probeDue`). `loadComputrabajoCoverage()` queda como envoltura. `pickDueFocusedCandidates` es el antiguo `pickDueComputrabajoCandidates` (alias conservado). |
| `src/direct/discovery/source-focus.ts` | Lista blanca de bolsas, `--focus-sources A,B` (excluyente con `--focus-computrabajo` y con `--candidates-file`), y el resumen puro del censo. |
| `scripts/discover-direct-employers.ts` | Acepta `--focus-sources Indeed,Glassdoor`. Solo reordena la misma cola; mismos límites. |
| `scripts/direct-source-coverage.ts` | Censo de solo lectura (modo `browser-boards-coverage` del workflow `Direct Employers Tick`). |
| `direct-employers-discovery.yml` | Nueva opción manual `focus=browser-boards`. **La programación sigue en `computrabajo`.** |

Límites que se reutilizan sin cambios: robots.txt (RFC 9309) en la vía del
sitio, `--limit`, `--max-enables 10`, `--deadline-min 9`, 3 en paralelo,
backoff por decisión (`nextProbeDays`), decisiones pegajosas, insert-only y
la regla de verificación de §7.1/§13 (nombre declarado, ≥ 1 vacante en
Colombia, no agencia, sin conflicto de dueño).

## 3. Vía oficial de Indeed / Glassdoor

No hay ninguna permitida para leer vacantes de terceros. Fuentes:
`docs/source-catalog/indeed.md` y `docs/source-catalog/glassdoor.md`
(verificados 2026-07-25): el Publisher API de Indeed está retirado y sus APIs
actuales son para empleadores/ATS asociados (publicar, no leer); la API de
Glassdoor solo está documentada para "API partners" asignados por Glassdoor.
No se agrega scraping ni evasión anti-bot (AGENTS.md regla 8).

## 4. Cifras

Censo de producción, solo lectura, aprobado por el dueño: `Direct Employers
Tick`, `mode=browser-boards-coverage`, run
[41449161057](https://github.com/Yosmanovallos/Job-finder/actions/runs/41449161057)
(2026-11-02, rama `codex/bolsas-a-empleadores-directos`). Cuenta todas las
filas vigentes de Indeed + Glassdoor, no solo las nuevas de la última
corrida (esas fueron Glassdoor 54 CO + 8 VE, Indeed 13 CO + 1 VE).

| Medida | Valor |
|---|---|
| Empresas distintas con vacantes vigentes | Colombia **1.005** · Venezuela 95 · sin país 0 |
| Vacantes de Indeed + Glassdoor en Colombia | 2.251 |
| Agencias conocidas | 5 |
| Ya con tablero oficial habilitado ("ya en el seed") | **20** (18 con ≥ 1 vacante oficial vigente) |
| Objetivo (sin tablero, no agencia) | **980** |
| …también en Computrabajo (la programación ya las alcanza) | 32 |
| Decisión en la cola | pending 560 · not_found 416 · known 2 · unsupported_ats 1 · needs_review 1 |
| Abiertas y listas para sondeo | **562** |
| Abiertas en backoff | 415 |
| **Candidatas nuevas frente a la programación actual** (listas y fuera de Computrabajo) | **562** |

Lectura:

- Las empresas con más vacantes ya se sondearon por nombre y salieron
  `not_found` (Bayport 290, Prosegur 33, Cargill 23, Seguros Bolívar 20,
  Essity 16, Coca-Cola FEMSA 10, Marriott 6…). Hoy están en backoff. El
  foco no les cambia nada: para ellas, la vía útil es la del sitio propio o el
  inventario ATS (D5, §13), no el nombre.
- Las 562 candidatas nuevas son la cola larga: cada una tiene ≤ 8 vacantes en
  esas bolsas (la lista sale ordenada por vacantes y la primera pendiente
  tiene 8). Ninguna se había sondeado porque el foco
  programado es Computrabajo y solo 32 de las 980 se solapan con él.
- Con el ~3 % de aciertos de §7, se esperan del orden de 15 tableros nuevos
  en total, insert-only y con tope de 10 por corrida.
- "known 2" sin tablero habilitado: tienen alias de empleador pero ningún
  tablero encendido; la causa no se verificó en este censo. No se reactivan.

Recomendación: no cambiar la programación. Basta con unas pocas corridas
manuales `focus=browser-boards` (ensayo en seco primero) para vaciar las 562;
después el backoff las espacia solo.

## 5. Cautelas

- **Venezuela**: el directorio excluye `country = 'VE'` y §7.1/§13 exigen una
  vacante en Colombia. Las empresas venezolanas se reportan aparte; sumarlas
  requiere enmendar el ADR 0006.
- **"333 pendientes"**: el origen de esa cifra del brief no está verificado
  en el repositorio. Ojo: el código tiene dos "pendientes" distintos — el
  `pending_review` del libro de revisión manual de Computrabajo
  (`direct-computrabajo-coverage.ts --all`) y la cola automática que lee
  `pickDue*`. El censo da las cifras reales de la cola (`dueNow`,
  `inBackoff`); no se mezclan.
- **Consulta generalizada**: el censo de Computrabajo pasó de
  `sources @> '["Computrabajo"]'` a `sources ?| $1`; ambos usan el índice
  GIN por defecto (`jsonb_ops`, `idx_jobs_sources`) y la prueba de
  integración comprueba que el resultado de Computrabajo no cambia.
- **Rendimiento esperado bajo**: §7 midió ~3 % de aciertos por nombre. Con
  decenas de empresas, se esperan pocos tableros nuevos. Cada uno, en cambio,
  trae todas sus vacantes, no solo las que Indeed/Glassdoor muestran.
- **Programación**: dar una de las tres corridas diarias a `browser-boards`
  no gasta más presupuesto, pero frena un tercio la cola de Computrabajo.
  Lo decide el dueño con las cifras del censo.

## 6. Orden de ejecución (ADR 0006: ensayo en seco primero)

1. `Direct Employers Tick` → `browser-boards-coverage` (solo lectura). Requiere aprobación.
2. `Direct Employers Discovery` → `mode=dry-run`, `focus=browser-boards` (no escribe). Requiere aprobación.
3. `mode=execute`, `focus=browser-boards` (insert-only, ≤ 10 tableros). Requiere aprobación explícita.
