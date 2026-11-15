# ADR 0016 — Extracto para vacantes de portales de terceros (D1(b))

**Fecha:** 2026-11-14
**Estado:** Borrador. **Es requisito aceptarlo antes de encender
`THIRD_PARTY_JOB_EXCERPT_ENABLED`.** Mientras siga en borrador, la bandera
no se enciende en ningún entorno.
**Contexto:** `openspec/changes/adsense-readiness/` (decisión D1, fase F2,
requisito ADS-030). Enmienda `docs/JOBPOSTING-GOOGLE-CONTRACT.md`.

## Problema

AdSense rechazó el sitio por «contenido de poco valor». La causa principal
de la matriz (CX-4, SP-11, SP-12) es que la mayoría de las páginas de
vacante reproducen la descripción completa de otro portal de empleo
(LinkedIn, Computrabajo, Elempleo, Magneto…). Para la primera revisión, el
propietario eligió D1(a): texto completo sin anuncios. D1(b) es la
contingencia por si hay una segunda negativa: mostrar solo un extracto de
esas vacantes.

D1(b) choca con el contrato JobPosting, que exige en `description` una
representación **completa** de la oferta, idéntica al cuerpo visible
(§2 y §3 del contrato). Un extracto no la cumple, así que una vacante con
extracto no puede emitir JobPosting.

## Decisión propuesta

Con `THIRD_PARTY_JOB_EXCERPT_ENABLED=true`, toda vacante cuya fuente no sea
«Portal oficial» (`jobProvenance()` en `src/lib/ad-eligibility.ts`):

1. Muestra como descripción los primeros 300 caracteres del texto de la
   fuente, cortados en una palabra (`buildJobExcerpt()`), sin los
   requisitos. Es un prefijo literal del texto real, nunca un resumen.
2. Conserva los bloques propios (miga, ficha, fuente nombrada, enlace a la
   oferta original, reputación, portal del empleador, otras vacantes de la
   empresa, «Más empleos en <ciudad>») y no carga anuncios.
3. Queda fuera del corpus de Google. Todos los consumidores del veredicto
   compartido deben estar de acuerdo, y en el código ya lo están:

   | Consumidor | Con la bandera encendida | Dónde |
   |---|---|---|
   | robots | `noindex,follow` | `renderJobPageHtml()` (`src/lib/job-page-render.ts`) |
   | JobPosting | no se emite | ídem |
   | `sitemap-jobs.xml` | la URL no aparece | `server.ts`, `isExcludedFromGoogleIndex()` |
   | `sitemap-jobs-recent.xml` | la URL no aparece | ídem |
   | Indexing API `URL_UPDATED` | no se envía | `checkIndexingTarget()` (`src/db/indexing-repository.ts`) |
   | IndexNow | la URL no se envía | `scripts/indexnow-submit.ts` |
   | Hidratación (`__SSR_JOB__`) | mismo extracto que el HTML del servidor (SP-1) | `renderJobPageHtml()` |
   | `/api/jobs/:id` | **sin cambio**: texto completo | ver «Abierto» |

4. Las vacantes de «Portal oficial» no cambian: página completa, JobPosting
   y anuncios según `seo_ready`.

Con la bandera apagada (por defecto) todas las funciones de
`src/lib/third-party-excerpt.ts` son la identidad: el HTML de la vacante es
byte a byte el anterior a F2 (prueba ADS-031 contra
`tests/fixtures/job-page-golden/`).

## Enmienda al contrato JobPosting

Al aceptar este ADR se añade a `docs/JOBPOSTING-GOOGLE-CONTRACT.md` §1
(elegibilidad) una condición más: «la página muestra la descripción
completa; una vacante de terceros con extracto (D1(b)) no emite JobPosting
y lleva `noindex`».

## Antes de encender la bandera

1. Medir (F0) cuántos clics de Google llegan hoy a vacantes de terceros
   (Search Console, 28 días). Es el tráfico que se pierde.
2. Aceptar este ADR y aplicar la enmienda al contrato.
3. Decidir el punto abierto de `/api/jobs/:id`.
4. Encender en el entorno de Render y verificar con `/seo drift compare`
   en dos vacantes de cada procedencia.

Retroceso: apagar la bandera (o quitar la variable). Se lee en cada
petición; no hay migración ni datos que restaurar. Las URLs que hayan
salido del índice vuelven a entrar en el siguiente rastreo del sitemap.

## Abierto

- `/api/jobs/:id` está bloqueado en `robots.txt` y lo usan el dashboard y
  las sesiones iniciadas para el detalle de la vacante. Recortarlo cambiaría
  lo que ve quien busca empleo en el dashboard, que no es una página
  indexable. Propuesta: dejarlo completo. Confirmarlo al aceptar el ADR.

## Alternativas descartadas

- **Extracto con JobPosting.** Rompe el contrato (descripción incompleta) y
  arriesga una acción manual de datos estructurados.
- **Extracto solo en el HTML del servidor.** La página hidratada mostraría
  el texto completo: no reduce la superficie copiada y rompe la paridad
  (SP-1).
