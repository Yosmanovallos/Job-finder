# Validación — 2026-10-29

Fase: medición agregada y política propuesta. Aplicación a964fce; trabajo
local codex/seo-lifecycle-strategy. Cambios solo docs/SQL/JSON/ADR/OpenSpec;
sin src, migración, configuración, dependencias ni despliegue de aplicación.

## Evidencia de producción

- Preflight: tablas jobs/expired_job_urls accesibles y transaction_read_only=on.
- SQL completo cotejado por copia del editor antes de ejecutar: coincidencia
  exacta con los archivos versionados. No se ejecutan selecciones parciales
  sin los guardas de transacción/timeout/rollback.
- Consulta general: 2026-10-29T12:17:49.012593Z, read_only on, 35.422 filas;
  conteos por fuente/país, clase de purga e histórico de hashes agregados.
- Consulta canónica SEO: 2026-10-29T12:21:38.70646Z, read_only on; 7.906
  candidatas, 2.129 próximas al umbral y 915 con vencimiento posterior al corte.
- Ambas READ ONLY/repeatable read, timeout 20 s/locks 2 s y ROLLBACK. No se
  devuelve una persona, cuenta, título, URL, id, hash individual o cuerpo HTML.
- Inspección de código confirma que source_checked_at también rota unknown;
  no se utiliza como evidencia de apertura.

## Gates

- RET-001: guardas de SQL verificadas y retorno real read_only=on. Sin DML/DDL
  en las consultas, sin referencias a auth/users/perfiles/saved jobs.
- RET-002: sumas por fuente coinciden con totales; grupos de purga suman
  35.422 y sus activas suman 34.778. Universo canónico separado de filas.
- RET-003: sumas diarias coinciden con los dos periodos por motivo;
  7.745/8.494 expired y 306/52 source_closed. Deltas calculados −8,82% y
  +488,46%, expresados como hashes retenidos con marca en periodo, no ledger
  completo ni retiros exclusivamente por antigüedad.
- RET-004: ADR propuesto separa cursor de verificación, exige open <24 h,
  preserva identidad y fechas, define unknown/cierre y bloquea habilitación
  antes de migración/pruebas. ADR 0005 sigue vigente en producción.
- pnpm lint: pasa.
- pnpm typecheck: pasa.
- pnpm test: 214 pasan; 8 de integración omitidas por configuración, no
  contadas como pasadas. No se reejecutan runners de aplicación/DB desechable
  para una entrega sin código; los SQL reales ya se probaron solo en lectura.
- git diff --check: pasa antes del cierre; comprobar staged al publicar.

La captura del navegador falló por timeout; no se presenta como guardada.
La tabla de resultados se leyó desde el grid visible de Supabase y se
persistió solo su JSON agregado. La consulta quedó abierta para revisión.

## Salida

Medición y definición terminadas. No se implementa todavía la excepción
de retención ni se restaura ninguna vacante. La siguiente fase deberá
instrumentar resultados y causas, simular la nueva política y pasar los
gates del ADR antes de modificar visibilidad. No se declaran clics salvados,
ofertas realmente abiertas adicionales ni crecimiento alcanzado.
