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

Pendiente: el censo corre contra producción y requiere aprobación del dueño
(`Direct Employers Tick`, `mode=browser-boards-coverage`, solo lectura).
Datos que entrega:

- empresas distintas de Indeed + Glassdoor en Colombia, Venezuela y sin país;
- cuántas ya tienen tablero oficial habilitado ("ya en el seed") y cuántas
  tienen vacantes oficiales vigentes;
- agencias; empresas objetivo; cuántas ya están también en Computrabajo (la
  programación actual ya las alcanza);
- distribución de `employer_discovery.decision`, listas para sondeo frente a
  en backoff, y **candidatas nuevas reales** = listas y fuera de Computrabajo.

Línea de referencia de la última corrida del navegador (dato del brief, no
del censo): Glassdoor 54 CO + 8 VE, Indeed 13 CO + 1 VE vacantes nuevas.

## 5. Cautelas

- **Venezuela**: el directorio excluye `country = 'VE'` y §7.1/§13 exigen una
  vacante en Colombia. Las empresas venezolanas se reportan aparte; sumarlas
  requiere enmendar el ADR 0006.
- **"333 pendientes"**: la cifra del brief coincide en forma con
  `pending_review` del libro de revisión manual de Computrabajo
  (`direct-computrabajo-coverage.ts --all`), que no es la cola automática que
  lee `pickDue*`. No se mezclan.
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
