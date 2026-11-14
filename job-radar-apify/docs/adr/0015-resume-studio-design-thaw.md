# ADR 0015 — Descongelar el AI Resume Studio solo para diseño y documentación

**Fecha:** 2026-11-14
**Estado:** aceptado por el propietario (solo diseño). La implementación sigue congelada.
**Rama:** `codex/resume-studio-design` (desde `origin/main` `320fcec`).
**Entregables:** `docs/resume-studio/` (documentos 01–10 y mockups).

## Contexto

- El CV Generator / Resume Studio / BYOK se retiró de producción el
  2026-10-18 (commit `053a21a`): unas 16 mil líneas, las rutas `/api/cv/*`,
  `/api/ai/*` y `/api/resume-studio/*`, y las dependencias pdfkit, docx,
  mammoth, pdf-parse y busboy. Nunca llegó a usuarios.
- Desde entonces hay tres textos que lo congelan:
  - `AGENTS.md` (raíz), sección «Production improvements — P0 verification»:
    «The CV Generator / Resume Studio / BYOK was removed from production on
    2026-10-18; do not reintroduce it.»
  - `docs/PROD-IMPROVEMENTS-PLAN.md` línea 13: «**Congelado:** CV Generator —
    no inspeccionar, modificar, mergear ni …».
  - `docs/AGENT-READINESS-RUNBOOK.md` líneas 23 y 115: el contrato público de
    agentes declara que no hay CV Generator.
- Las tablas `cv_profiles`, `cv_generations`, `llm_*`, `user_ai_credentials` y
  `cv_pii_vault` siguen en Supabase. `cv_pii_vault` tuvo RLS apagado con
  permisos públicos hasta el 2026-10-25.
- AdSense rechazó el sitio por «contenido de poco valor». El propietario
  quiere una herramienta original y útil, de pago, que no toque la gratuidad
  de las vacantes.

## Decisión

1. **Se levanta el congelamiento solo para diseñar y documentar** un módulo
   nuevo, «AI Resume Studio». Se permite:
   - leer el código actual y el historial (incluido `053a21a`) para auditar;
   - escribir documentos, ADR y un cambio OpenSpec en `docs/` y `openspec/`;
   - crear mockups y un prototipo aislado con datos sintéticos, fuera de
     `src/`, publicado aparte (artifact), sin tocar la app.
2. **La implementación sigue congelada.** Ningún cambio en `src/`, `server.ts`,
   migraciones, tablas de Supabase, variables de entorno, Render, Cloudflare
   ni Wompi hasta una aprobación explícita posterior del propietario, que
   deberá quedar en un ADR nuevo. El silencio o un mockup aprobado no cuentan
   como autorización (prompt maestro §12, Fase 7).
3. **No se reutilizan las tablas antiguas** sin una auditoría previa de RLS,
   grants y contenido. El diseño parte de tablas nuevas; la decisión sobre las
   viejas (borrar, archivar o reutilizar) es una tarea de la fase de
   implementación.
4. **Las vacantes, la búsqueda y los enlaces de aplicación siguen gratis y sin
   condiciones.** `PAYWALL_ENABLED` queda en `false`. El cobro del Resume
   Studio, si se aprueba, será un producto aparte que no comparte bandera con
   ese paywall.
5. **Los textos de congelamiento no se editan en esta fase.** `AGENTS.md`,
   `PROD-IMPROVEMENTS-PLAN.md`, `AGENT-READINESS-RUNBOOK.md` y `llms.txt` se
   actualizarán en la fase de implementación, si se aprueba. Este ADR es la
   excepción documentada para el trabajo de diseño.

## Consecuencias

- Los agentes pueden leer el historial del CV Generator para auditarlo, pero
  no restaurar su código.
- El contrato público de agentes sigue diciendo «sin CV» y sigue siendo cierto.
- El paquete de diseño incluye una propuesta de precio y de proveedor de IA;
  ninguna de las dos queda contratada ni configurada.

## Rollback

Borrar la rama `codex/resume-studio-design`. No hay nada desplegado.
