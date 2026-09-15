# P1 — Hotfix del sitemap y protección de memoria

**Estado:** archivado (implementado en `d03b7a5`, registro retrospectivo).

## Problema

`/sitemap-jobs.xml` llamaba `getJobsLightCached(50000)`, enmascaraba las
vacantes y construía el XML completo en memoria. En Render (~475 MB RSS
previos) la solicitud causó 502 en `/`, `/robots.txt` y `/api/health`, con
reinicio del servicio. Riesgo inmediato de estabilidad y de SEO (sitemap
caído).

## Qué se construyó

- Streaming por cursor PostgreSQL en lotes de 250 filas con backpressure
  real para clientes lentos (`src/db/job-repository.ts`, `src/server.ts`,
  `src/lib/job-seo.ts`).
- Máximo 50.000 URLs y una descarga concurrente por proceso.
- Timeout de consulta 10 s y duración total 30 s.
- Cancelación del cursor al desconectarse el cliente.
- `503` seguro ante saturación o fallo de base de datos.
- Eliminado el caché masivo anterior sin consumidores.
- XML, URLs y criterios de elegibilidad **idénticos** a la versión previa.

## Resultado (verificación)

- 100.000 filas sintéticas → 50.000 URLs emitidas correctamente.
- Heap adicional máximo ~34 MB; RSS máximo ~304 MB sobre 512 MB (>40% de
  margen).
- Unitarias: 23 controles verdes; integración completa verde; build verde.
- TypeScript: 29 errores heredados, 0 nuevos. Lint: 27 heredados, 0 nuevos.
- Sin contenedores residuales.

## Rollback

Preparado antes de publicar: ante regresión, responder con el último
sitemap válido o `503` seguro; no reactivar la implementación previa con
OOM conocido.
