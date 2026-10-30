# Diferenciar la página de vacante frente a la oferta original

**Base:** `origin/main` en `12d8eca`. **Tipo:** propuesta de diseño, sin código
de producción. **Alcance:** bloques fuera de la descripción en
`/empleos/:id/:slug`. Fuera de alcance: la descripción (contrato E), la regla
de 30 días (ADR 0008, decisión del usuario), el `<head>` y el sitemap.

## Problema

Search Console (informe de páginas, actualizado el 22-Oct): 569 indexadas,
9.745 rastreadas sin indexar, 7.095 descubiertas sin indexar. Una muestra de 6
páginas «rastreadas sin indexar», revisada por la sesión que encargó este
cambio (no está en ningún documento del repo), mostró que entre el 76 % y el
94 % del texto de nuestra descripción aparece textual en la oferta original
(LinkedIn, Elempleo). Ante dos copias casi iguales, Google tiende a quedarse
con la de más autoridad, que es la de la fuente.

La descripción no se puede tocar: el contrato
(`docs/JOBPOSTING-GOOGLE-CONTRACT.md` §2 y §3) exige que sea idéntica byte a
byte a la de la fuente y a la del JobPosting. Lo que sí se puede cambiar es lo
que rodea a la descripción.

## Evidencia propia (2026-10-30)

Muestra de 200 páginas de vacante en producción, leída de la carga
`window.__SSR_JOB__` y del HTML crudo de `#app`. Archivo:
`docs/seo-evidence/job-page-diff-2026-10-30.json`, solo con indicadores, sin
cuerpos ni nombres. No es una muestra aleatoria: son 8 bloques de 25 ofertas
a distintos desplazamientos del listado.

| Dato | Toda la muestra (200) | Indexables (35) |
|---|---:|---:|
| Página indexable (`seo_ready`, sin `noindex`) | 35 (17,5 %) | — |
| Reputación de la empresa (alias curado) | 18 (9 %) | 3 |
| Vacante del portal oficial del empleador | 14 (7 %) | 3 |
| `alsoIn` / `sources` > 1 (misma vacante en otro portal) | **0** | 0 |
| `applicantCount` | 1 (0,5 %), solo GetOnBoard | 0 |
| `employmentType` | 65 (32,5 %) | 31 |
| Salario visible | 19 (9,5 %) | 6 |
| `remoteType` informado | 22 (11 %) | 4 |
| Empleador «Confidencial» o sin nombre | 10 (5 %) | 1 |

En las 35 páginas indexables con descripción, la mediana de la descripción es
el **70 %** del texto de `#app`. El resto de palabras propias de la página,
sin contar el bloque «Más empleos en <ciudad>», tiene una mediana de **54**:
título, empresa, ubicación, fecha, tipo y fuente. Todo eso también está en la
página original. El bloque de ciudad (unas 85-90 palabras) sí es nuestro,
pero son títulos de otras vacantes y se repite entre las vacantes hermanas de
la misma ciudad.

Volumen de la empresa, en las páginas a las que apunta este cambio: de las 34
indexables de empleadores reales, 28 tienen 2 o más vacantes activas de la
misma empresa (mediana 7) y 25 tienen 2 o más en la misma ciudad (mediana 3).
En toda la muestra, 69 de 80 empresas tienen 2 o más (mediana 10, p90 80).
Son totales de la proyección canónica pública (`/api/jobs?company=` y
`&cities=`).

## Qué cambia

Se añaden bloques que salen de datos reales que la página original no tiene,
ordenados por cobertura y costo. El detalle está en `design.md`.

1. **Otras vacantes de la misma empresa** (todos los portales) con enlace a
   `/empresas/:slug`, con las de la misma ciudad primero. Es el bloque de más
   cobertura: 28 de las 34 indexables de empleadores reales. Ningún portal individual puede mostrar las
   vacantes que la empresa publicó en otros portales.
2. **Reputación de la empresa en el HTML inicial.** Ya se consulta para
   visitantes anónimos, pero hoy solo viaja en la carga de hidratación. Cubre
   el 9 % de la muestra. Ya aparece después de hidratar, así que esto es
   paridad del HTML crudo, no contenido nuevo para el renderizador de Google.
3. **Marca de empleador oficial** cuando la fuente es el portal propio de la
   empresa, y el enlace a su portal de empleo si está en la lista curada.
   Cubre el 7 % y el 0,5 %, respectivamente.

Diferido con condición: **«También publicada en»** (la misma vacante en otros
portales). Es el dato más exclusivo, pero hoy no existe: `alsoIn` vale 0 en
200 de 200. Las copias de otros portales son filas que pierden en el
`DISTINCT ON` canónico. Para mostrarlo hace falta medir antes cuántos grupos
tienen más de una fuente y decidir entre una consulta por grupo o una columna
precalculada (migración aditiva, con aprobación).

Excluido: fecha de observación propia (`last_seen_at` no prueba
disponibilidad, job-trust-2026-10), tecnologías (salen de la propia
descripción), número de postulantes
(0,5 %, y además ya está en la fuente), estadísticas de salario o FAQs (riesgo
de inferir lo que la fuente no dijo) y el hub de cargo (el emparejamiento por
rol es difuso; `SEO-JOB-LINK-GRAPH-2026-10-29.md` lo dejó fuera a propósito).

## Hallazgo aparte, sin corregir aquí

`buildJobMeta()` (`src/lib/job-seo.ts:272`) sigue emitiendo
«Vacante agregada de {fuente} en BuscoTrabajo…» como meta description en
todas las vacantes que no vienen del portal oficial. El contrato §5 la daba
por reemplazada en la fase I. Es copia de plantilla fuera de la descripción y
merece su propia entrega, porque cambia el `<head>` y requiere `seo-drift`.

## Resultado esperado y límites

En una muestra fija de URLs indexables, cada página muestra al menos un dato
real que la fuente no tiene y más enlaces internos, sin tocar la descripción, sin consultas
nuevas en el camino caliente y sin regresión de TTFB. Esto no garantiza
indexación ni posición. Los totales de GSC no permiten atribuir el efecto a
este cambio, porque el grafo de enlaces (desplegado) y #88/#89 se miden en las
mismas fechas. Los criterios de salida separan lo que controlamos de lo que
solo observamos (`design.md` §6).
