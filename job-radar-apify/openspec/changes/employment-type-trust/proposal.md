# Tipo de empleo fiable por fuente (employment-type-trust)

Fuentes afectadas: **Magneto y Elempleo**.

## Por qué

El conteo de solo lectura del 2026-11-07 (`seo-intent-wave2/validation.md`
§1) encontró 2.094 de 8.873 vacantes aptas de CO (24 %) con
`employment_type = 'Medio tiempo'`, en cargos de jornada completa evidente
(«Guardia de seguridad», «Operario de producción», «Conductor»). Nuestra
página de vacante lo repite tres veces: `employmentType: PART_TIME` en el
JobPosting, «Tipo de empleo: Medio tiempo» en la ficha visible y
«Medio tiempo.» en la meta description. Es un dato falso en la fuente que
Google Empleos usa para el filtro «Tipo de empleo», y Google Empleos trae la
mitad de los clics.

## Diagnóstico (detalle en `validation.md`)

- **Magneto rellena `employmentType` con el tipo de contrato, no con la
  jornada.** En 9 fichas públicas: las 6 con contrato «Por obra o labor»
  dicen `PART_TIME` (una de ellas con horario de 9 a. m. a 8 p. m.), las 2
  con «Término indefinido» dicen `FULL_TIME` (una es «Vendedor 6 horas», es
  decir, medio tiempo real) y la «Temporal» dice `TEMPORARY`. El valor falla
  en las dos direcciones, así que ningún valor de Magneto describe la
  jornada.
- **Elempleo hace lo mismo** con otros tokens: en 12 fichas, obra o labor →
  `PER_DIEM` («Por día»), término definido → `TEMPORARY`, indefinido →
  `FULL_TIME`, mientras su campo visible «Jornada laboral» dice «Tiempo
  completo».
- **Computrabajo es correcto**: 10 de 10 fichas (guardas, operarios,
  conductores) dicen `FULL_TIME`, igual que su «Tiempo Completo» visible.
- **Conteo por fuente** (solo lectura, autorizado por el propietario,
  2026-11-07): de 2.096 «Medio tiempo», **2.049 son de Magneto** (LinkedIn
  44, WeRemoto 2, Computrabajo 1). Las 346 «Por día» son todas de
  **Elempleo**; de las 282 «Temporal», Elempleo tiene 237 y Magneto 37.
  Computrabajo queda descartado, y con él la ruta `translate.goog`.

## Qué cambia

- `trustedEmploymentType(source, value)` (`src/lib/employment-type-trust.ts`)
  devuelve `undefined` para las fuentes `Magneto` y `Elempleo` y el valor tal
  cual para las demás.
- Se aplica en todo lo que muestra o emite el dato: JobPosting, ficha
  visible, meta description, payload de la página, API pública y las lecturas
  del repositorio (panel del dashboard). Así la marca y el texto visible no se
  contradicen.
- **No se borra nada**: `jobs.employment_type` conserva el valor crudo; la
  ingesta no cambia. Sin migración, sin escritura en producción.

## Qué no cambia

- Ningún otro campo del JobPosting; la vacante sigue siendo apta para Google
  (`employmentType` es «recomendado», no obligatorio:
  `docs/JOBPOSTING-GOOGLE-CONTRACT.md` línea 37).
- Las demás fuentes (Computrabajo, LinkedIn, Torre, Remotive,
  RemoteOK, WeRemoto, Workana) y el corpus directo (cuyos valores de
  `contractOrder.name` no coinciden con ninguna etiqueta del mapa de
  schema.org y ya se omitían del JobPosting).
- `content_hash`: hashea el valor crudo, así que este cambio no genera
  `URL_UPDATED`. Decisión deliberada: Google lo verá en su recrawl normal y
  no se envía una ráfaga de notificaciones (ver design D3).

## Riesgo y reversión

Riesgo: perder `FULL_TIME` correcto en algunas vacantes de Magneto y
Elempleo. Se acepta porque su campo no distingue jornada (D1); omitir es lo que el proyecto exige
ante un dato dudoso. Reversión: revertir el commit. No hay migración.

## Gates

`npx tsc --noEmit` (sin errores nuevos), `npm run build`, `npm run test:unit`
(incluye `validate-employment-type-trust.test.ts`), `npm run test:seo`, y
`/seo drift compare` contra las URLs de baseline antes de cualquier
despliegue. Merge y despliegue solo con aprobación del propietario.
