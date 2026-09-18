# Tareas — Agent Readiness 100

Orden obligatorio: especificación → pruebas rojas → implementación → validación → despliegue → rescaneo.

## 0. Baseline

- [x] Leer AGENTS.md, runbook de rendimiento y documentación SEO obligatoria.
- [x] Inspeccionar Git/worktrees y confirmar worktree limpio desde `origin/main@5dddeee` con `d67fc32` incluido.
- [x] Rescan Is Agentic: 44/100, 2026-09-18T01:02:04Z.
- [x] Rescan API IsItAgentReady: nivel 1, 2026-09-18T01:18:28Z.
- [x] Confirmar commerce no aplicable y OAuth/Web Bot Auth no implementables honestamente.

## 1. Pruebas rojas

- [ ] ARE-001..006: contenido, headings, trust pages, JSON-LD y metadata.
- [ ] ARE-007..011: 404, Markdown, Vary y errores JSON.
- [ ] ARE-012..018: API, OpenAPI, docs, llms y catálogos.
- [ ] ARE-019..023: MCP, Agent Skills, WebMCP, ARD y A2A.
- [ ] Confirmar fallo antes de implementar.

## 2. Implementación

- [ ] Contenido público y negociación.
- [ ] API pública versionada y errores.
- [ ] Recursos de descubrimiento estáticos.
- [ ] MCP/A2A/WebMCP read-only.
- [ ] Cierre del fallback SPA.
- [ ] Metadata, JSON-LD, robots, sitemap y enlaces visibles.
- [ ] Runbook y referencias permanentes.

## 3. Gates locales

- [ ] `npm run test:agent-readiness`.
- [ ] `npm run test:unit`.
- [ ] `npm run test:integration`.
- [ ] `npm run test:baseline`.
- [ ] `npm run test:seo`.
- [ ] `npm run test:dashboard-filters` y `npm run test:companies-search`.
- [ ] `npm run build`.
- [ ] `npx tsc --noEmit`, separando baseline heredado de errores nuevos.
- [ ] lint enfocado y global, separando baseline heredado.
- [ ] `git diff --check`.
- [ ] smoke HTTP y navegador.
- [ ] proceso frío, warmup y dashboard con URL única.
- [ ] `/seo drift compare` en URLs afectadas.

## 4. Publicación

- [ ] Revisar diff completo y confirmar cero archivos de CV Generator.
- [ ] Confirmar cero cambios de planes/costos y cero servicios nuevos.
- [ ] Commit y push seguros.
- [ ] Integrar a `main` vigente sin force, rebase destructivo ni checkout del worktree CV.
- [ ] Esperar Render Live; revisar startup y `dashboard_cache_warmed`.

## 5. Producción y cierre

- [ ] Smoke de todas las rutas y esquemas.
- [ ] Medición dashboard Cloudflare MISS y duración Render.
- [ ] Rescan Is Agentic.
- [ ] Rescan IsItAgentReady con perfil aplicable.
- [ ] Iterar fallos corregibles.
- [ ] Registrar scores, enlaces, evidencia, costos y bloqueos.
- [ ] Archivar este cambio OpenSpec después del despliegue verificado.