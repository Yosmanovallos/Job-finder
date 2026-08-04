# CLAUDE.md — job-radar-apify (BuscoTrabajo.co)

Notas específicas de este subproyecto. No reemplaza el `CLAUDE.md`/`AGENTS.md`
de la raíz del repo (esos siguen aplicando); esto es lo adicional que
importa solo aquí.

## SEO — lectura obligatoria antes de tocar nada relacionado

Cualquier cambio que toque SEO (rutas públicas de `src/server.ts`,
`src/lib/job-seo.ts`, sitemap, `robots.txt`, schema JSON-LD, hreflang,
contenido/descripción de vacantes, títulos/meta) requiere leer primero:

1. **`docs/SEO-IMPROVEMENT-PLAN.md`** — el plan activo, con el plugin
   [claude-seo](https://github.com/AgriciDaniel/claude-seo) instalado
   (scope `local`, `/seo <comando>`). Trae los no-negociables (nunca
   inventar datos, migraciones solo aditivas, una fase por sesión,
   verificación propia antes de dar por terminado) y la tabla de fases.
2. **`docs/SEO-PLAN.md`** §9-10 — diagnóstico de causa raíz y fixes ya
   aplicados (2026-08-04): bug de churn de URL corregido (`last_seen_at`),
   hreflang `/`↔`/ve`, descripción de JobPosting enriquecida.
3. **`docs/QA-CHECKLIST-SEO.md`** — checklist manual que `test:seo` no
   cubre (Rich Results Test, revisión visual).

**Después de cualquier cambio SEO**: actualizar la tabla de fases de
`docs/SEO-IMPROVEMENT-PLAN.md` con el resultado, y correr `/seo drift
compare` contra las URLs de baseline (sección 2 de ese documento) antes
de decir que el cambio está listo — no basta con que `test:seo` pase, ese
test verifica forma/regresión funcional, no las señales que Google
realmente lee.

## No-negociables de este subproyecto

- **Nunca inventar datos**: ni salarios, ni descripciones, ni volumen de
  búsqueda de keywords. Sin fuente real y verificable, se omite.
- **No hay base de datos de test separada** — el mismo `DATABASE_URL` de
  `.env` es el de producción (`docs/SEO-PLAN.md` §0). `test:seo` es de
  solo lectura a propósito; `test:paywall`/`test:payment-flow` sí
  escriben y están detrás de `ALLOW_TEST_DB_WIPE=true` — nunca correrlos
  como parte de una verificación de SEO.
- **Migraciones de esquema siempre aditivas** (`ADD COLUMN IF NOT
  EXISTS`, patrón de `scripts/migrate-*.ts`), corridas explícitamente,
  nunca automáticas ni parte de un script que ya corre en producción.
- **Una fase a la vez**, verificable antes de la siguiente — ver la tabla
  de `docs/SEO-IMPROVEMENT-PLAN.md`.
- **Verificación propia siempre**: `npx tsc --noEmit && npm run build &&
  npm run test:seo` (+ `test:dashboard-filters`/`test:companies-search`
  si se tocó `server.ts`) antes de declarar cualquier cosa terminada —
  nunca delegar esa verificación al usuario.
- **`/seo setup` para dependencias del plugin, nunca `pip install`
  manual** — venv aislado propio, mismo criterio que el resto del
  proyecto con Node/npm.
