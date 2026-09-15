# Plan de mejoras de producción — BuscoTrabajo (job-radar-apify)

Documento maestro del roadmap aprobado. Fuente de verdad para el estado de
cada fase. Los artefactos OpenSpec por cambio viven en `../openspec/`.

**Base:** `74f066b32bc843188a72ea89204124e76c5e08c9`
**Worktree:** `Job-finder-prod-improvements`
**Rama:** `codex/prod-improvements-seo-ux-security`
**Regla:** una fase por sesión; cada fase requiere propuesta → spec →
implementación → gates → registro aquí antes de pasar a la siguiente.

**Congelado:** CV Generator — no inspeccionar, modificar, mergear ni
cherry-pick nada relacionado.

## Objetivo

Mejorar la aplicación desplegada sin dañar su comportamiento: estabilidad
bajo crawlers, consultas públicas y sitemaps con memoria acotada,
diagnóstico real de fuentes (vacío ≠ bloqueado ≠ fallido ≠ sin configurar),
ingesta con deadlines y cancelación efectivos, enriquecimiento persistente,
nuevas fuentes API/feed-first, proxies solo donde estén autorizados, y
mejoras de SEO/UX/seguridad/observabilidad.

## Estado del roadmap

| Fase | Contenido | Estado | Commit | OpenSpec |
|---|---|---|---|---|
| P0 | Aislamiento de tests, PostgreSQL desechable, baseline | ✅ Done | `a73a85e` | `openspec/changes/archive/p0-test-isolation/` |
| P1 | Hotfix sitemap: streaming, memoria acotada | ✅ Done | `d03b7a5` | `openspec/changes/archive/p1-sitemap-streaming/` |
| P2 | Observabilidad: `ScrapeRun`/`SourceAttempt`, estados clasificados, `/api/runs` | ✅ Done | `74bbe7a` | `openspec/changes/archive/p2-run-observability/` |
| P3 | Timeouts efectivos, cancelación, cadencia, leases | 🔵 Spec draft | — | `openspec/changes/p3-execution-deadlines/` |
| P4 | Contrato `SourceFetchResult`, transporte/proxy por política | ⬜ Pendiente | — | — |
| P5 | Recuperación de adaptadores (una fuente por entrega) | ⬜ Pendiente | — | — |
| P6 | Cola persistente de enriquecimiento + calidad de datos | ⬜ Pendiente | — | — |
| P7 | Coherencia CO/VE, remoto, catálogo comercial | ⬜ Pendiente | — | — |
| P8 | SEO sostenible: sitemaps fragmentados, elegibilidad, Indexing API | ⬜ Pendiente | — | — |
| P9 | Nuevas fuentes (Greenhouse, Lever, Ashby primero) | ⬜ Pendiente | — | — |
| P10 | UX y rendimiento móvil | ⬜ Pendiente | — | — |
| P11 | Hardening y auditoría de salida | ⬜ Pendiente | — | — |

Leyenda: ✅ done · 🔵 spec/draft · 🟡 en implementación · ⬜ pendiente ·
🔴 bloqueada.

## Hallazgos de base (verificados en `74f066b`)

- Paginación SQL y caché acotado de páginas ya existían — no rehacer.
- `/sitemap-jobs.xml` cargaba hasta 50.000 vacantes y construía todo el XML
  en memoria → reproducible OOM/502 en Render. **Resuelto en P1.**
- `/api/runs` lee el historial del caché JSON local, no ejecuciones reales.
  **Resuelto en P2** (lee `scrape_runs`; el caché JSON sigue escribiéndose
  para scripts heredados, pero ya no es fuente de historial).
- Varias rutas devuelven `[]` ante errores, bloqueos o circuito abierto.
- Timeouts del tick usan `Promise.race` sin cancelar el trabajo restante.
- Enriquecimiento: hasta 8 vacantes nuevas por adaptador/rol; las omitidas
  o fallidas no tienen cola persistente.
- Workflows en Node 20; la app declara Node `24.18.0`.
- Baseline de gates heredados: 35 errores de typecheck, 33 de lint en
  tests históricos. Reportar siempre separados de errores nuevos.
  *(Corrección de alcance, P2: en `61ec1b1`, `npx tsc --noEmit -p .` en
  `job-radar-apify` da 29; `npx eslint job-radar-apify` desde la raíz del
  worktree da **295** en todo el paquete, 52 de ellos en `tests/`. La cifra
  "27" de P1 correspondía a un alcance más estrecho no registrado. Desde P2
  el gate es un diff antes/después del mismo comando por archivo y regla.)*
- `validateJobs()` no incluye `Jooble` en `KNOWN_SOURCES`: toda vacante de
  Jooble se descarta antes de persistir. Visible desde P2 como
  `failed / all_rejected_by_validation`; corregir en P5/P6.
- Scrapers de `src/index.ts` distintos de Jooble siguen tragando errores y
  devolviendo `[]` sin señal; P2 solo cubre `executeWithResilience`, Jooble
  y los scrapers de navegador. Pendiente en P4/P5.
- Entorno (2026-09-15): los metadatos git de este worktree fueron podados
  por un proceso externo (patrón `git worktree prune` desde WSL, que ve la
  ruta `C:/…` como inexistente) y se recrearon con aprobación. Recomendado:
  `git worktree lock` sobre este worktree y no ejecutar `prune` desde WSL.

## Contratos propuestos (aprobar antes de programar cada fase)

| Contrato | Responsabilidad |
|---|---|
| `SourcePolicy` | Métodos autorizados, mercado, límites, atribución, permisos |
| `FetchContext` | Identidad de ejecución, deadline, cancelación, presupuesto |
| `SourceFetchResult` | Datos, estado, contadores por etapa, error clasificado |
| `ScrapeRun` / `SourceAttempt` | Historial operativo persistente, correlación con Actions |
| `EnrichmentTask` | Recuperación de detalles con lease, reintentos, idempotencia |
| `FieldEvidence` | Procedencia y versión de extracción por campo |
| `PublicationEligibility` | Decisiones separadas para UI, sitemap, `JobPosting`, Indexing API |
| `SitemapGeneration` | Versión, fragmentos, conteos, integridad, publicación atómica |

## Gates de aceptación (objetivos, no resultados obtenidos)

- **Memoria:** cero OOM con 100k vacantes sintéticas, concurrencia y
  refresco; ≥30% de margen RSS. *(P1: superado — ~34 MB heap extra,
  ~304 MB RSS máx. sobre 512 MB.)*
- **Compatibilidad:** mismas identidades, canonical, filtros y respuestas
  para instantánea fija, salvo diferencias aprobadas.
- **Rendimiento:** sin deterioro >10% del p95 del baseline bajo igual carga.
- **Ejecución:** deadline efectivo, cancelación comprobada, recuperación
  sin efectos duplicados.
- **Observabilidad:** todos los intentos clasificables; ejecuciones
  muertas reconciliadas; ningún fallo presentado como éxito vacío.
- **Calidad:** en fixtures, todo valor extraído respaldado por la fuente;
  cero moneda/fecha/descripción inventada.
- **Enriquecimiento:** ≥90% de éxito sobre detalles realmente disponibles
  y permitidos de fuentes intervenidas.
- **SEO:** cero drift crítico inexplicado; fragmentos válidos; conjunto
  elegible completo y sin duplicados.
- **Coste:** límites configurados antes de activar servicios pagados;
  alerta y corte al presupuesto.
- **Pruebas:** lint, typecheck, build, unitarias e integración en verde
  (o igual a baseline heredado, reportado aparte), sin usar producción
  como base de pruebas.

## Reglas de despliegue y rollback

Secuencia por fase: aprobar spec → tests que fallan → implementar en
entorno aislado → comparar contra baseline → staging sin escrituras
externas → canario productivo acotado → ampliar solo si cumple gates →
registrar aquí.

- Migraciones aditivas y compatibles con la versión anterior.
- Flags por capacidad/fuente cuando sean útiles.
- No borrar datos para desactivar un adaptador.
- Retener versión anterior del artefacto y del conjunto de sitemaps.
- Ante regresión de datos: detener el escritor afectado; no "limpiar"
  producción automáticamente.
- Ningún merge, push, despliegue o escritura externa queda autorizado
  por aprobar una fase.

## Detalle por fase

### P3 — Duración, cancelación y cadencia
Alinear runtime app/workflows; instalación reproducible (eliminar
`npm ci || npm install` silencioso); `AbortSignal` y deadlines en red y
tareas; presupuesto comprobado antes de cada fuente/página/lote; progreso
incremental reanudable; reclamación atómica con lease/heartbeat; CO/VE
aislados; enriquecimiento fuera del camino crítico. GitHub documenta que
cron de Actions puede retrasarse o perderse — si persiste, mover disparador
y worker a scheduler gestionado con coste aprobado.

### P4 — Contrato de fuentes y transporte
`SourceFetchResult` tipado adoptado gradualmente; separar descubrimiento,
detalle y verificación; registro de capacidades/políticas por fuente;
límites centralizados; respetar `Retry-After`; circuitos separados para
listado y detalle. Proxy como transporte configurable y autorizado
(directo por defecto, credenciales fuera del código, límites por fuente,
feature flag). La ruta browser ya contempla `WEBSHARE_PROXY_URL`. Sin
evasión de CAPTCHA, login ni anti-bot.

### P5 — Recuperación de adaptadores (uno por entrega)
- **Jooble CO/VE:** validar habilitación regional y cuota (documentación
  oficial: 500 solicitudes por vida de clave), credencial/mercado,
  paginación, semántica de fechas.
- **Remotive:** medir antes/después del filtro 48 h; retraso oficial del
  feed es 24 h; revisar permisos de redistribución y exposición SEO.
- **Indeed VE:** diagnosticar la ruta browser realmente usada; separar
  denegación, localización, parsing, ausencia de inventario.
- **Glassdoor:** verificar qué descripción entrega el acceso autorizado;
  no completar textos ausentes artificialmente.
- **Computrabajo CO/VE:** recuperación de detalles; validar parser
  salarial con evidencia original.
- **GetOnBoard:** mapeo de empresa/relaciones, descripción, selección
  geográfica; "Confidencial" solo cuando corresponda.
- **LinkedIn CO/VE:** cobertura de detalle y pendientes sin deteriorar
  el listado que ya aporta.
- **Torre, Workana, Elempleo, Magneto, WeRemoto, RemoteOK:** baselines y
  canarios de conservación; corregir solo con evidencia de degradación.

### P6 — Enriquecimiento persistente y calidad
Cola con estados `pending`/`running`/`retryable`/`complete`/`unavailable`;
backfill acotado; reintentos con límite y `next_attempt`; priorización por
antigüedad/relevancia/capacidad; actualización idempotente que no
sustituye dato válido por vacío; `FieldEvidence` por campo; sanitización
de HTML; distinguir descripción completa/extracto/no disponible.
Salarios: conservar texto original, separar importe/moneda/periodicidad,
no interpretar `$` como USD. Fechas: no confundir actualización con
publicación; no renovar artificialmente en cada scrape.

### P7 — Coherencia CO/VE y remoto
Separar modalidad remota de elegibilidad geográfica; `country=null` no
significa "cualquier país"; medir nueva clasificación en modo sombra;
unificar registro operativo de fuentes/filtros/lista comercial (caso
Workana/VE); "sin ciudad especificada" cuando sea útil; taxonomía por
país/híbrido con muestras reales preservando slugs.

### P8 — SEO sostenible
Después del hotfix: sitemaps fragmentados (~5.000 URLs inicial, ajustar
midiendo; respetar límite de URLs y 50 MB sin comprimir); índice que
enlace fragmentos; generación consistente con publicación atómica;
conservar último conjunto válido ante fallo; transición compatible para
la ruta histórica; no generar todo el corpus dentro de una solicitud web;
sin duplicados CO/VE. `JobPosting` condicionado a datos suficientes,
vigencia y permiso. Separar "notificado a Google" de "indexado". Repetir
Search Console, CrUX y Rich Results. Leer `SEO-IMPROVEMENT-PLAN.md`,
`SEO-PLAN.md` §9-10 y `QA-CHECKLIST-SEO.md` antes de tocar SEO.

### P9 — Nuevas fuentes
Primer lote: **Greenhouse, Lever, Ashby** sobre catálogo pequeño de
empresas con oportunidades CO/VE/LATAM (APIs públicas por empresa;
requieren mantener identificadores de portales). Después: We Work
Remotely (revalidar acceso documental), Himalayas, Jobicy (condiciones),
SmartRecruiters (revisar ADR 0002 antes de activar), Bumeran VE/Empléate
y SPE/SENA (investigación regional; no convertir boletines agregados en
empleos). Cada alta demuestra: uso permitido, vacantes únicas pertinentes,
identidad estable, dedupe correcto, cobertura empresa/ubicación/descripción,
coste por vacante útil, manejo de vacío/errores/cambio de esquema, y
desactivación sin borrar datos válidos. Ver skill `build-source-adapter`.

### P10 — UX y rendimiento móvil
Mantener estado de error y `Reintentar`; diferenciar búsqueda vacía de
fuente degradada/datos desactualizados; mostrar publicación original,
última verificación y procedencia sin confundirlas; división de código y
carga diferida seguras; medir antes de cambiar el flujo de detalle; QA
móvil, teclado, accesibilidad, comparación visual CO/VE.

### P11 — Hardening y auditoría
Límites por ruta/coste en endpoints públicos pesados; protección SSRF en
URLs de fuentes (hosts autorizados, redirecciones controladas, bloqueo de
redes privadas); sanitización XSS en descripciones; SQL parametrizado y
validación de filtros; autorización server-side en administración; logs
sin tokens/PII; CSP en modo reporte primero; dependencias y Actions
verificadas; simulacros de caída de BD, proveedor, timeout, reinicio y
rollback.

## Decisiones por defecto

- Conservar el stack productivo; no migrar la app al monorepo original.
- PostgreSQL para coordinación y colas iniciales (no Redis/Kafka).
- Corregir el worker antes de contratar otro scheduler.
- Transporte directo por defecto; proxy solo por fuente y con presupuesto.
- Nuevas fuentes por APIs de empresas, no más navegadores.
- No activar servicios pagados sin aprobar proveedor y límites.
- No ampliar países: mejorar CO/VE y elegibilidad remota.

## Historial de sesiones

| Fecha | Fase | Resultado |
|---|---|---|
| 2026-09-15 | P0 | Commit `a73a85e`. Runner aislado, PostgreSQL desechable, baseline 9 rutas/18 capturas. Gates heredados documentados (35 tsc / 33 lint, 0 nuevos). |
| 2026-09-15 | P1 | Commit `d03b7a5`. Sitemap en streaming (lotes de 250, backpressure, 50k máx., 1 descarga concurrente, timeouts 10s/30s, cancelación de cursor, 503 seguro). 100k filas sintéticas, ~34 MB heap extra, ~304 MB RSS. tsc 29 heredados / lint 27 heredados, 0 nuevos. |
| 2026-09-15 | P2 | Commit `74bbe7a`. `scrape_runs`/`source_attempts` aditivos (RLS + `REVOKE`); `RunRecorder` clasifica cada intento con señales reales (circuito abierto, deny, reintentos agotados, errores tragados, credencial ausente, rechazo por validación) — ningún fallo como éxito vacío; latido 60 s, reconciliación a `interrupted` (10 min) y derivación en lectura; rezagados → `timeout` sin sobrescritura; retención 30 d; `/api/runs` desde Postgres (forma compatible, paginado, sin datos operativos, `503` ante fallo) y `/api/admin/runs` con `OPS_ADMIN_TOKEN` fail-closed. Tick de navegador incluido. OBS-001…012 en integración; unit 34/34, integración 6/6, baseline y build en verde. tsc 29 / eslint 295 heredados (alcance corregido, ver hallazgos), 0 nuevos. Sin migración en BD real, sin push ni despliegue. |
