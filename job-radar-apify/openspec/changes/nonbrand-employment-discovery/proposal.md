# Descubrimiento de empleo sin depender de la marca

Estado: primera entrega autorizada, baseline y selección de piloto; cambio de
aplicación pendiente. Fecha: 2026-10-27, America/Bogota.
Alcance de esta entrega: investigación y estrategia verificadas.
No cambia código, esquema, configuración de Google ni producción.

## Problema y objetivo

BuscoTrabajo.co tiene visibilidad para la marca concatenada, pero muy poca
para búsquedas genéricas de empleo. El objetivo es aumentar impresiones,
clics y conversiones útiles sin marca en Colombia y Venezuela, con páginas
que resuelvan la intención y restricciones reales del candidato. La meta
incluye competir por primeras posiciones; no se garantiza una posición,
plazo de indexación ni cobertura de todas las palabras posibles.

No basta con insertar variantes de «busco trabajo». Google reconoce
variaciones lingüísticas y considera múltiples señales. La coincidencia del
dominio no otorga por sí sola preferencia por una búsqueda genérica.

## Evidencia reproducible

### Google, 27 de octubre de 2026

Tres búsquedas manuales en Chrome, español, país Colombia, pws=0. Google
indicó resultados no personalizados; mantuvo ubicación por IP Santa Fé,
Bogotá. Es una observación puntual, no un rastreo exhaustivo de posiciones.

| Consulta | Observación en primera página |
|---|---|
| busco trabajo | Computrabajo Bogotá, Servicio Público de Empleo, elempleo, Magneto, Bogotá Trabaja e Indeed. BuscoTrabajo.co no apareció en los resultados web observados. |
| busco trabajo en bogota sin experiencia de lunes a viernes | Computrabajo, Indeed, elempleo, Magneto y LinkedIn con páginas específicas; también bloque de empleos y resumen IA. BuscoTrabajo.co no apareció en los resultados web observados. |
| buscotrabajo | Aparecen el inicio de BuscoTrabajo.co y su dashboard. No se afirma que el primer resultado sea propio ni que otras cuentas/ubicaciones reproduzcan el orden. |

También se observó la pestaña del usuario en página 7 para «busco trabajo»,
sin resultado propio entre los resultados visibles. No se inspeccionaron
todas las páginas intermedias ni se concluye ausencia absoluta del índice.
Los snippets de competidores son evidencia de su presentación, no validación
de sus inventarios ni afirmaciones que podamos copiar.

### Search Console, Web, propiedad sc-domain:buscotrabajo.co

Ventana 2026-09-27 a 2026-10-24, dejando margen por retraso de reporte.
Fuente: interfaz autenticada de Rendimiento, consulta exacta aplicada mediante
el filtro Consulta exacta. Totales sin filtro antes de aplicar ese filtro:
34 clics, 1,68 mil impresiones (valor redondeado mostrado), CTR 2%, posición
media 11,1. Alcance global de la propiedad, no exclusivamente Colombia.

| Consulta visible | Clics | Impresiones | Posición media |
|---|---:|---:|---|
| busco trabajo, filtro exacto | 0 | 1 | 79 |
| buscotrabajo, tabla sin filtro | 4 | 42 | No extraída |
| empleo puerto ordaz | 2 | 9 | No extraída |
| empleos puerto ordaz | 1 | 24 | No extraída |
| empleos en puerto ordaz | 1 | 15 | No extraída |
| empleo san francisco | 1 | 4 | No extraída |
| empleos cucuta | 1 | 2 | No extraída |
| trabajos en caracas | 0 | 16 | No extraída |
| empleos caracas | 0 | 14 | No extraída |
| empleos manizales | 0 | 13 | No extraída |

La posición 79 tiene UNA impresión: no es un puesto fijo ni permite estimar
demanda o significancia. Las consultas visibles no suman necesariamente los
totales, por anonimización/límites de reporte. No restar cuatro clics de marca
a 34 y llamar «sin marca» a todos los restantes. No clasificar automáticamente
«busco trabajo» como marca: coincide con una intención genérica.

### Producción y capacidad actual

HTTP del 27-Oct: inicio, dashboard, Bogotá y la vacante de control responden
200. El inicio ya tiene título «Busco trabajo en Colombia: ofertas de empleo»
y H1 con «Busco trabajo en Colombia»; no falta la frase objetivo.
Bogotá presenta título de empleo local y canonical propio. La corrección
de render de PR #15 sigue presente en la vacante de control. Esto no prueba
que todas las páginas estén indexadas o rindan igual.

La interfaz Job revisada en este checkout declara descripción, requisitos,
ubicación y modalidad, pero no un contrato tipado explícito de experiencia
mínima y jornada semanal. Antes de implementar se revisará origin/main actual,
la BD y las fuentes: la falta de esos campos tipados no demuestra ausencia
total de esa información en textos o propiedades extendidas.

## Diagnóstico: hechos e hipótesis

Confirmado: baja exposición de la frase exacta, diferencia marca/genérico,
competidores con páginas locales/de condiciones, y coincidencia de keywords
ya presente en inicio. Hay primeras señales de captación sin marca.

Hipótesis a contrastar: cobertura insuficiente de intenciones específicas,
inventario/enlaces internos poco adecuados para ellas, indexación limitada,
y diferencias de confianza/autoridad respecto de competidores. No se han
medido backlinks comparativos; no afirmar penalización, sandbox, una falla
de Google o «falta de autoridad» como causa demostrada.

Las consultas generales compiten con portales, fuentes oficiales, mapas
locales, bloques de empleos y resúmenes IA. Se medirán por separado resultados
web de categorías, JobPosting de vacantes y referencias de asistentes.

## Estrategia y mapa inicial de intención

Una intención, una página principal. Sinónimos naturales en una misma página;
no crear /busco-empleo, /busco-trabajo y /ofertas-laborales equivalentes.
La tabla es una hipótesis de segmentación, no volúmenes de búsqueda medidos.

| Grupo | Variantes de ejemplo | Página destino / condición |
|---|---|---|
| Empleo nacional CO | busco trabajo, busco empleo, buscar empleo en Colombia, ofertas de empleo, vacantes laborales, bolsa de trabajo | Inicio CO; revisar su relación con dashboard para diferenciar intención sin cambiar canonicals arbitrariamente. |
| Empleo nacional VE | empleo en Venezuela, ofertas laborales Venezuela | /ve, con inventario y contenido VE. |
| Ciudad CO | trabajo en Bogotá, empleos Bogotá, vacantes Bogotá; equivalentes Cúcuta/Manizales | Categoría existente de la ciudad; priorizar por GSC, inventario y capacidad de responder. Bogotá objetivo estratégico, no oportunidad fácil demostrada. |
| Ciudad VE | empleo puerto ordaz, empleos en Puerto Ordaz, trabajo en Caracas | Resolver URL canónica existente y país correcto; Puerto Ordaz tiene evidencia inicial de clics. |
| Ocupación + ciudad | auxiliar administrativo Bogotá, auxiliar de bodega Bogotá, atención al cliente Bogotá, ingeniero civil Caracas | Reutilizar categoría si responde; una nueva combinación solo tras probar demanda e inventario. No asumir estas consultas tienen volumen conocido. |
| Experiencia | trabajo sin experiencia Bogotá, primer empleo, vacantes sin experiencia | Nueva faceta/página solo si hay evidencia explícita de experiencia y resultados suficientes. «Junior» no equivale a «sin experiencia». |
| Jornada | empleos de lunes a viernes, medio tiempo Bogotá, trabajo fines de semana | Diferenciar días de trabajo y duración contractual; no inferir lunes-viernes por FULL_TIME. |
| Modalidad | trabajo remoto Colombia, empleo desde casa, trabajo híbrido Bogotá | Usar modalidad y elegibilidad geográfica verificadas; Colombia no equivale a remoto global. |
| Intención informativa | cómo buscar empleo sin experiencia, cómo evitar ofertas falsas | Guía útil con fuentes, autor y fecha real de revisión; enlazar categorías relevantes. No usar guía para simular inventario inexistente. |

Validar una lista finita de 20–30 consultas por país/dispositivo y URL,
priorizada por impresiones reales, posición, intención, conversión e inventario.
No usar el orden de búsquedas relacionadas como volumen de demanda.

## Entregas secuenciales propuestas

Una sesión y un OpenSpec implementable por fase. Este documento es el borrador
de la fase siguiente permitido por openspec/README.md; no crea design/tasks
de fases futuras ni declara cerrados gates anteriores.

1. **Base y selección del piloto.** Reconciliar despliegues recientes con el
   roadmap; exportar GSC 28/90 días por consulta/página/país/dispositivo; separar
   marca explícita, genérico y ambiguo; inspección dirigida de 5–10 páginas.
   Seleccionar máximo tres páginas CO y dos VE por evidencia e inventario.
   Entregable: matriz consulta→intención→URL→inventario→estado de indexación,
   baseline y decisión de los pilotos. No requiere esperar a tener volumen pago.
2. **Piloto de páginas existentes.** Contenido útil local, empleos reales,
   claridad de fuente/frescura y acceso a ofertas. Enlazado desde inicio,
   navegación de empleos, categorías hermanas y detalle pertinente. Anclas
   descriptivas, breadcrumbs reales y profundidad acotada; respetar el nuevo
   diseño de inicio ya desplegado por otro trabajo. No añadir keyword lists.
3. **Facetas verificadas.** Una capacidad por entrega: primero experiencia,
   después jornada si las fuentes lo permiten. Definir esquema aditivo,
   procedencia, extracción determinista con negaciones y estado unknown.
   Medir cobertura antes de abrir páginas a Google. Conjunción explícita de
   ciudad AND experiencia AND jornada, sin resultados parciales camuflados.
4. **Publicación selectiva de combinaciones.** Propuesta inicial de gate:
   demanda observada + al menos cinco vacantes activas distintas, dos
   empleadores y contenido útil diferenciado. Son mínimos propuestos, no una
   regla de Google; validar su sostenibilidad 14 días. Publicar pocas páginas,
   sitemap/enlaces solo para las admitidas. No expandir producto cartesiano.
5. **Confianza, contenido y difusión.** Transparencia de fuentes y empleo
   original, orientación práctica, colaboraciones editoriales legítimas con
   comunidades/formación/empleadores. Investigar referencias y backlinks
   antes de atribuir carencias; nada de compra de enlaces o redes artificiales.
   Distribuir enlaces a páginas útiles con UTM, midiendo conversiones.
6. **Lectura de resultados y siguiente lote.** Revisión a 7/14/28 días desde
   cada despliegue, con fechas completas y latencia de GSC. Escalar solo si
   las páginas se rastrean, mantienen calidad y aparecen señales útiles.
   Ampliar observación con poco tráfico; no declarar ganador por una impresión.

## Requisitos observables para promover el piloto a especificación

- **NBD-001 — Identidad de intención.** Variantes equivalentes remiten a una
  URL principal; la matriz no contiene páginas clonadas por sinónimo.
  Escenario: «empleos Bogotá» y «trabajo en Bogotá» comparten categoría.
- **NBD-002 — Contenido y descubrimiento.** Título, H1, texto útil, ofertas y
  enlaces se mantienen en HTML y DOM móvil; no reaparece el falso Soft 404.
  Escenario: API bloqueada por robots conserva la vacante ya pública.
- **NBD-003 — Filtros respaldados.** Cada coincidencia de experiencia/jornada
  tiene evidencia y procedencia; unknown no cumple una condición afirmativa.
  Escenarios adversariales: «mínimo dos años», «no aceptamos personal sin
  experiencia», «lunes a sábado», «un sábado al mes» no se anuncian como
  sin experiencia/lunes-viernes estricto. Texto externo nunca ejecuta acciones.
- **NBD-004 — Precisión de la promesa.** Una página que promete tres condiciones
  no incluye empleos que cumplen solo una. Las guías y las vacantes mantienen
  hechos reales; «urgente», «hoy» y salarios solo con respaldo válido.
- **NBD-005 — Control de escala.** No indexar búsqueda libre, ordenamientos
  infinitos ni páginas de combinaciones sin gate; sitemap y canonical coherentes.
  Cero resultados se informa de verdad, con alternativas claramente etiquetadas;
  una combinación no aprobada no se presenta como catálogo indexable lleno.
  La política de continuidad/retirada de páginas aprobadas se define antes de
  publicar, evitando alternancia de index/noindex por fluctuaciones de horas.
- **NBD-006 — Medición honesta.** Marca concatenada/dominio separada de términos
  genéricos; consultas ocultas no clasificadas arbitrariamente. Métricas
  registradas por país/página/fecha, con cantidades y porcentajes.
- **NBD-007 — Producción protegida.** Preservar cache SWR/warmup, budget Render,
  404/410, negociación Markdown, APIs públicas read-only y autenticación.
  Nada de CV/BYOK ni auto-apply. No abrir /api/ para resolver SEO.
- **NBD-008 — Datos estructurados.** JobPosting en detalles aptos, no un
  JobPosting ficticio de una lista; categoría con estructura acorde a su
  contenido y breadcrumbs, sin inventar reseñas ni condiciones laborales.

## Gates, pruebas y rollback

Antes de código: origin/main actual en worktree codex/, inventario de archivos,
contratos y pruebas a tocar; leer runbooks de performance/agent-readiness cuando
corresponda y plan SEO completo. Convertir únicamente la entrega en alcance a
design.md, tasks.md y specs con IDs NBD trazables y pruebas de regresión.

Pruebas: filtros con positivos/negativos/unknown/negaciones; concordancia SSR
y cliente; rutas vacías/inexistentes/retiradas; canonical/noindex/sitemap;
enlaces HTML; CO/VE; móvil; XSS e inyección en textos de fuentes. Test DB solo
en PostgreSQL desechable, red externa bloqueada en unitarias, baseline con
envDir:false. Lint, typecheck, unitarias y criterios propios deben pasar para
cerrar fase; registrar fallos históricos sin supresiones. No afirmar que los
conteos antiguos siguen vigentes sin reejecutar sobre la nueva base.

Revisar diff, metadata antes/después y dashboard en proceso frío/URL única
edge MISS si se toca la ruta de consulta. Mantener presupuesto Starter+Free.
Publicar por cambio pequeño y verificar health, páginas piloto y Google.
Rollback por commit del piloto; migraciones solo aditivas y explícitas, sin
borrar datos existentes. Archivar OpenSpec únicamente al completar gates.

## Métricas y criterio de éxito

- Primarias: clics e impresiones de consultas genéricas identificables hacia
  páginas piloto, usuarios orgánicos útiles y altas confirmadas agregadas.
- Secundarias: páginas piloto indexadas, cobertura top20/top10/top3 del
  conjunto rastreado, CTR a posición comparable y usuarios outbound_apply.
- Guardrails: sin aumento de Soft404, páginas vacías indexables, falsos
  positivos de filtros, errores de acceso, latencia o costes injustificados.
- Objetivo direccional: ampliar captación sin marca antes de perseguir solo
  el término nacional más competitivo. Los objetivos +500%/+1500% se mantienen
  como aspiraciones con base y fecha explícitas, nunca promesas de esta fase.
- Si indexa y no imprime: reevaluar demanda/intención y diferenciación; si
  imprime sin clics: posición, SERP y snippet; si llegan usuarios sin avanzar:
  confianza y fricción. La correlación temporal no prueba causalidad.

## Primera entrega recomendada

Entregada la matriz en `baseline.md`, con cinco inspecciones almacenadas,
una prueba viva de Bogotá y evidencia de inventario en `inventory.json`.
Piloto seleccionado: Cúcuta y Caracas para captación; Bogotá para recuperación
de descubrimiento/indexación. Manizales y Puerto Ordaz quedan en reserva por
motivos distintos documentados allí. No se implementa la fase de páginas.

Matriz de consultas/páginas y piloto de categorías existentes, antes de abrir
facetas nuevas. Bogotá es estratégica; Cúcuta y Puerto Ordaz tienen primeras
señales propias. La elección final requiere relacionar las consultas con su
URL y el inventario vigente. No prometer «lunes a viernes sin experiencia»
hasta que el catálogo pueda responderlo con precisión comprobable.

## Fuentes

- Search Console UI: propiedad sc-domain:buscotrabajo.co, Web,
  2026-09-27..2026-10-24; consulta exacta busco trabajo; observado 27-Oct.
- Google web, Chrome Colombia/español, tres consultas y alcance descritos arriba.
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/appearance/ranking-systems-guide
- https://developers.google.com/search/docs/essentials/spam-policies
- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Ejemplos observados: https://co.computrabajo.com/empleos-en-bogota-dc y
  https://co.computrabajo.com/trabajo-de-lunes-a-viernes-en-bogota-dc-sin-experiencia;
  https://co.indeed.com/l-bogot%C3%A1,-cundinamarca-empleos.html;
  https://www.elempleo.com/co/ofertas-empleo/trabajo-sin-experiencia-de-lunes-a-viernes.
- Referencias internas: docs/SEO-GROWTH-EXECUTION-PLAN.md,
  docs/JOB-RENDER-SEO-VERIFICATION.md, openspec/README.md.
