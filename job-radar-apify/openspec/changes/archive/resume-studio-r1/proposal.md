# Resume Studio R1 — CV base: subir, extraer, confirmar (sin IA)

**Estado:** implementado con **alcance ajustado** y archivado (2026-11-21).
Rama `codex/resume-studio-r1`, PR contra `codex/resume-studio`. Evidencia en
[`validation.md`](validation.md).

> **Alcance ajustado (2026-11-21, encargo de la sesión R0).** R1 se cerró sin
> subida de archivos: CV base **creado desde cero y editado a mano**. Quedan
> fuera de R1 y pasan a un cambio posterior (antes de R3): subida PDF/DOCX,
> validaciones de archivo y su auditoría de librerías (punto 4), extracción
> determinista con `source_span` (punto 5) y la prueba T-FILE. El esquema de
> hechos ya trae `source` y `sourceSpan` (nulo) para recibirlas. La
> precondición D6 **sigue abierta**: necesita acceso de solo lectura a
> Supabase y aprobación del propietario; R1 no toca esas tablas ni Supabase.
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../../docs/adr/0017-resume-studio-implementation.md).
**Rama:** `codex/resume-studio-r1`, cortada de `codex/resume-studio` (no de
`origin/main`); vuelve a `codex/resume-studio` por PR. Nada a `main`.
**Fuente de fases:** doc 11 §8 (manda sobre la tabla del doc 10).

## Problema

El flujo «link de vacante → CV adaptado» (doc 11 §1.1, §5) necesita un **CV
base** confiable: hechos del candidato con su fragmento de origen
(`source_span`), confirmados por el usuario, sobre los que R3 construirá las
tarjetas y el validador de factualidad. Hoy no existe nada de esto en el
código (el CV Generator viejo se retiró el 2026-10-18 y sigue congelado).

## Precondición

- **D6 completado:** auditoría de solo lectura de `cv_profiles`,
  `cv_generations`, `llm_*`, `user_ai_credentials` y `cv_pii_vault` en
  Supabase (RLS, grants, conteo y antigüedad, sin leer contenido personal),
  con el resultado escrito en `docs/resume-studio/` y aprobado por el
  propietario. R1 **no** reutiliza esas tablas.

## Alcance

1. **Esquema `rs_*` aditivo** (doc 06 §3): `rs_consents`, `rs_resumes`,
   `rs_resume_versions` como mínimo; migración `scripts/migrate-*.ts`
   con `IF NOT EXISTS`, probada **solo** en el Postgres desechable de
   `npm run test:integration`. **Nunca** se ejecuta contra Supabase/`DATABASE_URL`.
2. **Rutas detrás de `RESUME_STUDIO_ENABLED=false`** (por defecto): con la
   bandera apagada, todo el módulo responde 404 y las vacantes no cambian.
3. **Autorización al subir** (S3): tres casillas con el texto legal enlazado,
   registradas en `rs_consents` con versión del texto y fecha.
4. **Subida PDF/DOCX** con validaciones del doc 06 §5: ≤ 2 MB, firma de bytes
   (`%PDF-`, ZIP con `word/document.xml`), máx. 4 páginas, rechazo de PDF
   cifrado o con JavaScript/acciones y de DOCX con macros, objetos
   incrustados o relaciones externas; 1 parseo concurrente; librerías JS
   puras, sin binarios nativos, auditadas antes de agregarlas.
5. **Extracción determinista** (sin LLM) a un borrador de hechos con
   `source_span`, y **revisión campo a campo** por el usuario («confirmar»).
   La extracción con LLM es de R3.
6. **3 plantillas** y **vista previa** con los mismos componentes que usará
   el PDF.
7. **Versiones**, borrar y exportar los propios datos (derechos del titular).

## Fuera de alcance

IA de cualquier tipo, resolver de links (R2), tarjetas y puntajes (R3),
Wompi y pases (R4), tracker (R4b), cambios a `PAYWALL_ENABLED`, a
scrapers/adaptadores, búsqueda, caché del dashboard, Render, `llms.txt` o el
contrato público de agentes.

## Criterio de salida

- `npx tsc --noEmit`, `npm run build`, `npm run test:unit` y
  `npm run test:integration` verdes (fallos heredados de la base reportados
  aparte, sin suprimirlos).
- T-FILE (archivos maliciosos y límites), T-IDOR (un usuario no ve ni edita
  CV ajenos), T-DEL (borrado completo), T-FREE (vacantes intactas con la
  bandera apagada y encendida) en verde (doc 09).
- Con `RESUME_STUDIO_ENABLED=false`, el dashboard y `/api/*` públicos se
  comportan igual que en `main` (runbook de rendimiento del dashboard).
- Sin datos personales reales en fixtures ni logs.

## Rollback

Borrar `codex/resume-studio-r1`. Nada desplegado ni migrado en Supabase.
