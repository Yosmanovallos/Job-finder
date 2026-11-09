# Diseño — employment-type-trust

## D1. Omitir todo valor de Magneto y Elempleo, no solo `PART_TIME`

Magneto mapea su campo de contrato a `employmentType`: obra o labor →
`PART_TIME`, indefinido → `FULL_TIME`, temporal → `TEMPORARY`
(`validation.md` §2). Un `FULL_TIME` de Magneto tampoco dice nada de la
jornada («Vendedor 6 horas» sale `FULL_TIME`). Quitar solo `PART_TIME`
dejaría `FULL_TIME` en vacantes de medio tiempo real. Se omite todo valor de
Magneto y nunca se adivina desde el título (AGENTS.md regla 5).

Elempleo hace lo mismo con otros tokens (obra o labor → `PER_DIEM`,
definido → `TEMPORARY`, indefinido → `FULL_TIME`; 12 de 12 fichas), así que
recibe el mismo trato. A diferencia de Magneto, Elempleo sí publica la
jornada en un campo visible («Jornada laboral: Tiempo completo»). Leerlo
sería un parser nuevo y queda como fase aparte (D4).

El filtro es por el valor exacto de `jobs.source` (`"Magneto"`, el que
escriben `src/sources/magneto-catalog.ts` y `fetchMagnetoDetail`). El corpus
directo de Magneto (`src/direct/ats/magneto.ts`) se proyecta con otra fuente
y guarda `contractOrder.name` («Término indefinido», «Por obra o labor»…),
que no coincide con ninguna clave de `EMPLOYMENT_TYPE_LABEL_TO_SCHEMA`, así
que ya no llegaba al JobPosting. Queda igual. Para Elempleo, `"Elempleo"` es
el valor que escriben `scrapeElempleo` y `fetchElempleoDetail`.

## D2. Filtrar al mostrar, no al ingerir

`recordDetailOutcome` escribe `employment_type = COALESCE($5,
employment_type)`: dejar de guardar el valor en la ingesta no limpiaría las
filas existentes. Un backfill sería una escritura en producción (Supabase
Nano, sensible a Disk IO). El filtro en la salida corrige las 2.094 filas al
instante y conserva el dato crudo por si Magneto cambia o se quiere
reinterpretar como «tipo de contrato». Un backfill queda como opción
separada, solo con aprobación (tasks §5).

Un solo helper (`trustedEmploymentType`) y todos los puntos de salida lo
usan: JobPosting, ficha visible, meta description, payload SSR, API pública y
los mapeos de lectura de `job-repository.ts`. Así no hay ninguna superficie
que diga «Medio tiempo» mientras otra lo calla.

## D3. Sin señal de actualización

`computeContentHash` usa el `employment_type` crudo, que no cambia. El
JobPosting cambia, pero no se encola `URL_UPDATED` para ~2.000 URLs: Google
lo recoge en su recrawl normal y se evita una ráfaga contra la cuota de la
Indexing API. Si el propietario prefiere avisar, se puede hacer después con
el mecanismo existente, en lotes.

## D4. Alternativas descartadas en esta fase

Mapear `PART_TIME`+Magneto → «Obra o labor» sería inferir el contrato desde un
mapeo no documentado de Magneto. El contrato visible está en el HTML, pero
leerlo exigiría un parser nuevo de Magneto; queda fuera de esta fase.

Leer «Jornada laboral» del HTML de Elempleo daría un dato real de jornada,
pero también es un parser nuevo con su fixture y sus pruebas: siguiente
fase, si el propietario la quiere.
