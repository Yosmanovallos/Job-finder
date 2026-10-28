# Plan de crecimiento SEO y conversión — BuscoTrabajo.co

Fecha de preparación: 2026-10-24 America/Bogota. Plan propuesto, no ejecución
de nuevas fases. Referencia técnica verificada: producción `main@badb497`,
PR #15. Antes de cada ejecución confirmar nuevamente la revisión desplegada.

## Resultado buscado y límites de la evidencia

Aumentar visitas orgánicas útiles, registros reales y salidas voluntarias a
ofertas. +500% significa multiplicar por 6 la base; +1500%, multiplicar por
16. Son objetivos del usuario, no resultados alcanzados ni pronósticos.
Si la base es cero, informar la cantidad absoluta: el porcentaje no existe.
Publicar juntos porcentajes y cantidades para evitar conclusiones engañosas
con bases pequeñas. No interpretar indexable como indexado ni un evento de
salida como una contratación o postulación completada en otro sitio.

El objetivo original es crecer este mes: evaluar el cierre de octubre contra
una base explícita; quedan aproximadamente siete días y no hay evidencia
para garantizar ese resultado. El calendario de 30 días siguiente es un
ciclo operativo de ejecución/medición, no un cambio silencioso de esa meta.

## Qué ya está resuelto

Actualización operativa 28-Oct: piloto de enlaces Bogotá/Cúcuta/Caracas
publicado y verificado, PR #66/#67. Lint global y typecheck pasan; los conteos
de errores históricos del 24-Oct abajo no describen ya estos gates actuales.
Mapa de ampliación (fase 3) documentado en
`../openspec/changes/seo-market-coverage/report.md`: veinte oportunidades,
inventario público y siguiente lote Armenia/Neiva/Ibagué/Popayán/ingeniero
civil VE. Esta entrega documental no implementa la fase 4 ni prueba crecimiento.

- Corrección del disparo y deduplicación de `sign_up`, PR #14, `bb8a01d`.
  Falta la aceptación con tráfico real posterior al despliegue.
- Corrección de vacantes vigentes que Google renderizaba como ausentes,
  PR #15, `badb497`. La misma URL pasó de Soft 404 a disponible/indexable,
  con una oferta válida en prueba en vivo a las 21:42 del 24 de octubre.
- En esa publicación pasaron renderizado móvil/escritorio, unitarias,
  integración PostgreSQL aislada y baseline. Producción saludable en la
  muestra comprobada; dashboard MISS externo 374 ms, sin drift de metadata.
- No rehacer robots, canonicals, hreflang, schemas, caché ni Indexing API
  por defecto: investigar fallos concretos antes de cambiarlos.

## Pendientes confirmados y pendientes por verificar

Confirmados: aceptación de analytics con uso real; indexación efectiva y
evolución del informe de ofertas; cobertura de la corrección en más URLs;
24 errores históricos de TypeScript y 261 de lint; variabilidad del test de
memoria de sitemap (primer intento +66.1 MB, siguiente +40.9 MB, límite 64 MB).
La fase de renderizado no se declara cerrada mientras sus gates sigan abiertos.

Por verificar: demanda y posiciones actuales por consulta, rendimiento de
páginas locales, abandono del embudo, cobertura de descripciones por fuente,
CWV de campo disponibles y funcionamiento del monitoreo. Los diagnósticos de
agosto/septiembre no describen automáticamente el estado de octubre.
No reabrir trabajo histórico sin contrastarlo con producción y sus pruebas.

## Secuencia de trabajo

Cada fase tiene su propia sesión, especificación y cambio revisable. No
encadenar implementaciones de distintas fases en el mismo contexto. Las
ventanas de observación pueden continuar sin cambios de código. Los días
son orientativos: si un gate falla, se reprograma el siguiente trabajo.

| Fase y prioridad | Trabajo y entregable | Criterio de salida |
|---|---|---|
| 0 — P0. Cierre técnico actual | Inventario de errores por causa; corregir tipos/lint sin supresiones ni tocar funciones congeladas; investigar variabilidad de memoria sin ampliar límites; actualizar estados de publicación y evidencia. | Lint, typecheck, unitarias y criterios de renderizado pasan; integración/baseline si aplica. Archivar OpenSpec solo al cerrar todos los gates. |
| 1 — P0. Medición confiable | Reporte base GSC + GA4 + cuentas reales agregadas; conciliar definiciones de alta, confirmación y onboarding; verificar eventos clave autorizados y UTM. Documentar cualquier discrepancia. | Ventanas completas reproducibles, fechas/zona horaria y latencia de datos indicadas; eventos sin duplicación por refresco/login; controles de pruebas e internos explícitos; registros reales separados de eventos. |
| 2 — P0. Recuperación de indexación | Muestra inicial de 12–20 URLs: vacantes aptas de varias fuentes, páginas locales CO/VE y controles retirados/inexistentes. Inspección almacenada y prueba viva acotadas por cuota; sitemap/readiness/canonical/render concordantes. Seguimiento 7/14 días. | Muestra de vacantes aptas conserva contenido y es indexable; retiradas 410 e inexistentes 404 según contrato; causas de exclusión agrupadas y acción por causa. Indexación efectiva se informa por separado, sin prometerla. |
| 3 — P1. Demanda y mapa de búsquedas | GSC 28/90 días: marca/sin marca, país, dispositivo, consulta y página. Revisar resultados públicos de competidores, intención, canibalización y demanda servible con inventario real. Matriz de hasta 20 oportunidades. | Cada oportunidad tiene evidencia, intención, URL destino existente/propuesta, inventario disponible, prioridad y fecha. Volúmenes solo si una herramienta da datos verificables para país/fecha; no son requisito para usar GSC. |
| 4 — P1. Páginas permanentes | Optimizar inicialmente 3–5 páginas existentes de ciudad/ocupación elegidas en fase 3: título/H1, texto útil propio, empleos reales, navegación y enlaces internos relevantes. Evaluar combinaciones ciudad+rol solo con demanda e inventario suficientes. | HTML y DOM útiles, canonical único correcto, sin duplicados de intención; consistencia país/filtros; metadata, móvil y latencia verificados. Nada de cientos de páginas vacías o variaciones automáticas. |
| 5 — P1. Calidad de vacantes | Medir porcentaje visible/apto para Google, descripción real, frescura, fuente y causa de rechazo. Priorizar una fuente por entrega; completar información únicamente desde fuentes permitidas. | Mejora verificable de cobertura/calidad sin relajar readiness, inventar campos ni exponer vacantes cerradas. Contratos/canarios autorizados y pruebas de expiración pasan. |
| 6 — P1. Conversión | Medir vista→intento de aplicar→registro→onboarding→salida. Revisar móvil, claridad del registro, errores de autenticación, retorno a la oferta y fricción del apply gate. Probar un cambio por entrega. | Flujo real mantenido sin pruebas de altas en producción; eventos/retorno correctos; comparación por canal/dispositivo y sin caída material de salidas. No forzar el registro como éxito si perjudica al candidato. |
| 7 — P2. Contenido y distribución | Contenido útil basado en demanda observada; piloto de 7 piezas diarias reutilizadas para TikTok, Instagram y X, con enlaces a páginas permanentes y UTM. Inspeccionar cuentas, permisos, formatos y capacidad del programador antes de publicar. | Calendario, piezas verificadas, enlaces y atribución revisables; medición de visitas útiles y conversiones por pieza. Aprobaciones de publicación según canal; sin salario/vacante inventados, spam ni promesas de contratación. |
| 8 — Continua. Medición y decisiones | Comparar 7 días completos vs 7 anteriores y tendencia 28 días; revisar incidentes, cohortes y registros reales. Mantener monitor existente sin duplicarlo. | Reporte con cantidades, variaciones, límites y próxima acción; alertas solo ante cambios relevantes o fallos. Revisión de impacto al día 30; decidir mantener, corregir o retirar cada cambio. |

## Métricas y método

GSC: clics, impresiones, CTR, posición; consultas/páginas, marca/sin marca,
país y dispositivo. Separar web y apariciones de ofertas si Google ofrece
esa dimensión. Usar últimos siete días completos con datos disponibles
contra los siete anteriores e indicar retraso; GA4 con esas mismas fechas.
Comparaciones adicionales de GA4 más recientes se etiquetan por separado.

GA4: usuarios, sesiones, Organic Search, usuarios que dispararon `view_job`,
`apply_gate_open`, `sign_up`, `onboarding_complete`, `outbound_apply` y sus
conteos. Medir embudos por sesión/cohorte con definición explícita, no dividir
eventos repetidos entre usuarios para simular una tasa de conversión.
Usuarios ya autenticados pueden saltarse registro y onboarding; medir esa
ruta aparte. Si los eventos carecen de vinculación suficiente, declarar
esa limitación antes de presentar un embudo secuencial.

Registros reales: solo conteos agregados de cuentas nuevas y confirmadas,
excluyendo pruebas mediante una regla documentada. No inferir pruebas por
intuición ni exportar correos, identificadores o perfiles. Un fallo en la
consulta no se reporta como cero registros. Reiniciar base de eventos desde
la corrección de altas; no comparar eventos antiguos inflados como usuarios.

Salud: HTTP, render móvil, frescura/calidad del inventario, errores de sitemap,
401 de rutas privadas, latencia dashboard con URL única/MISS y, si hay datos,
CWV de campo. Pruebas de laboratorio se distinguen de métricas de usuarios.

## Calendario orientativo y decisiones

- Días 1–3: cierre de gates y medición base, en sesiones separadas. La
  observación de indexación comienza desde el despliegue ya realizado.
- Días 4–7: muestra de indexación, mapa de consultas y elección de páginas.
  Entregar evaluación del cierre de octubre con los datos que existan.
- Días 8–14: primer lote de páginas permanentes; mejora de una fuente si
  el diagnóstico demuestra que limita la oferta de contenido útil.
- Días 15–21: cambio de conversión basado en abandono medido y piloto
  de distribución. Piezas publicadas solo tras revisar contenido/permisos.
- Días 22–30: medir impacto, optimizar oportunidades con señales suficientes
  y decidir el siguiente lote. Si el tráfico es insuficiente para concluir,
  informar incertidumbre y ampliar observación, no declarar un ganador.

Reglas de diagnóstico: si no indexa, resolver exclusión/render/contenido;
si indexa pero no recibe impresiones, revisar demanda e intención; si obtiene
impresiones pero no clics, revisar posición, SERP y snippet; si llegan visitas
pero no hay registros útiles/salidas, trabajar confianza y fricción. Ninguna
de estas señales por sí sola demuestra la causa.

## Herramientas y seguridad de ejecución

Search Console y GA4 autenticados son fuentes primarias. GSC Wizard informó
suscripción vencida en la revisión anterior: revalidar disponibilidad y usar
el acceso directo mientras tanto. Semrush puede servir para investigación
si su conexión/cuotas aportan datos reales. Metricool puede servir para
distribución si las cuentas y formatos están habilitados. No contratar,
instalar o comprar herramientas como condición automática para avanzar.

Cada publicación: worktree `codex/` desde `origin/main` actual, propuesta de
archivos/interfaces/pruebas antes de editar, OpenSpec, build y gates, pruebas
aisladas sin credenciales de producción, comparación metadata antes/después,
despliegue revisable y health checks. Rollback por cambio acotado; migraciones
solo aditivas y explícitas. Fuentes en vivo solo con autorización y bandera.
No abrir APIs privadas a crawlers para reparar problemas de renderizado.

Preservar caché/warmup del dashboard, separación CO/VE, contratos públicos
read-only y el presupuesto Render existente (<USD 10/mes). No reintroducir
CV/Resume Studio/BYOK, auto-apply ni envíos de candidaturas automáticos.

## Primera acción concreta

Siguiente entrega: fase 4 sobre el lote de cinco páginas del mapa del 28-Oct,
con inspección almacenada previa, enlaces útiles por país, contenido basado en
datos reales y gates de publicación. El piloto del 27-Oct conserva seguimiento
7/14/28 días. Aceptación de analytics y embudo real siguen pendientes; no se
declaran resueltos por disponer del mapa SEO. Remoto VE, taxonomía de cargos
nuevos y equivalencia Puerto Ordaz/Ciudad Guayana requieren sus propias pruebas.

Referencias: `JOB-RENDER-SEO-VERIFICATION.md`, `ANALYTICS-FUNNEL.md`,
`PROD-IMPROVEMENTS-PLAN.md`, `SEO-IMPROVEMENT-PLAN.md` y OpenSpec de ambas
correcciones. El registro más reciente y la producción comprobada prevalecen
sobre estados de despliegue históricos sin actualizar.
