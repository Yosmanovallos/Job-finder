# Método y contratos

SQL Editor de Supabase autenticado; no .env ni claves. Preflight confirmó
tablas jobs/expired_job_urls y transaction_read_only=on. Ambas consultas se
copiaron completas a la UI y se verificó coincidencia exacta antes de Run.
READ ONLY, repeatable read, statement_timeout 20 s, lock_timeout 2 s, ROLLBACK.

Primera consulta: una proyección materializada de jobs con clasificador de
purga, conteos por fuente/país y umbral de edad siete días; hashes retenidos
en 22–28-Oct vs 15–21-Oct, con días completos America/Bogota.
Segunda: reproduce DISTINCT ON canónico ANTES de seo_ready del sitemap real.
No suma duplicados ni todo Workana al corpus SEO. Snapshots separados por
cuatro minutos: no tratarlos como la misma transacción o misma descarga XML.

Devuelve solamente contadores, fechas, fuente/mercado y motivos; no títulos,
URLs, identificadores, hashes, HTML ni datos de personas. El agregado de
expired_job_urls no es un ledger inmutable; explicar upserts y retención.

No tratar source_checked_at como verificación open: el código rota unknown.
No interpretar last_seen, vencimiento futuro o HTTP 200 como confirmación.
La excepción propuesta exige nueva evidencia afirmativa/fecha/método.

La salida es una política versionada y un dry-run de conteos de lectura;
no hay migración ni habilitación de estados nuevos. Rollback documental,
sin reversión de datos porque no se modificaron.
