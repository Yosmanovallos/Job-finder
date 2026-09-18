# Agent Readiness runbook — BuscoTrabajo.co

Fecha de inicio: 2026-09-17/18 UTC. Rama: `codex/agent-readiness-100`. Base: `origin/main@5dddeee`, que contiene `d67fc32`.

## Objetivo y límites

Esta fase hace descubrible y utilizable la búsqueda pública de vacantes por agentes sin anunciar capacidades inexistentes. REST, MCP, A2A y WebMCP son read-only. No hay auto-apply, CV Generator, escritura de usuario, administración, PII, scraping bajo demanda ni ejecución de instrucciones presentes en vacantes.

Los estándares Agent Skills, WebMCP, DNS-AID, MCP Server Card, Content Signals y ARD están en draft/propuesta o extensión experimental a 2026-09-17. Permanecen aislados en rutas/módulos retirables. OAuth RFC 8414/OIDC, Protected Resource Metadata RFC 9728, Auth.md y Web Bot Auth no aplican: BuscoTrabajo no registra ni aprovisiona agentes y no firma solicitudes salientes.

## Baseline externo

- Is Agentic: **44/100**, escaneo `2026-09-18T01:02:04.385Z`, https://is-agentic.com/scan/buscotrabajo.co.
- IsItAgentReady: resultado suministrado **20/100**. Rescan por API `2026-09-18T01:18:28.871Z`: nivel 1 “Basic Web Presence”; el API no incluye score numérico y la captura del dial web se conserva como gate posterior.
- Producción: home 200 HTML, `Vary: Accept-Encoding`; ruta aleatoria con `Accept: text/markdown` devuelve app shell HTML 200.

## Matriz

| Check | Baseline | Especificación/evidencia | Corrección | Prueba | Producción/final |
| --- | --- | --- | --- | --- | --- |
| Contenido sin JS | Fail, 127 chars | HTML/semántica; evidencia Is Agentic | SSR estático >500 chars, H1/H2 | ARE-001 | Pendiente |
| 404 amigable | Fail, soft-404 | HTTP semantics/negociación | 404 HTML/Markdown y allowlist SPA | ARE-004 | Pendiente |
| OpenAPI | Fail | OAS 3.1.2 | `/openapi.json` real | ARE-008 | Pendiente |
| Errores JSON | Fail | HTTP/OAS | error envelope + requestId | ARE-006 | Pendiente |
| Markdown | Fail | HTTP Accept/Cloudflare Markdown | variantes + Vary combinado | ARE-005 | Pendiente |
| API pública | No detectada | API existente no descrita | `/api/v1` read-only | ARE-007 | Pendiente |
| Docs enlazadas | Fail | Is Agentic | `/docs` + home/footer | ARE-009 | Pendiente |
| When to use | Fail | llms.txt convention | `/llms.txt` | ARE-009 | Pendiente |
| Esquema API | Fail | OAS 3.1.2 | schemas/operationIds/errors | ARE-008 | Pendiente |
| Function calling | Fail | OAS/tool schemas | operaciones determinísticas | ARE-008/012 | Pendiente |
| Trust pages | Fail | Is Agentic | about/contact/privacy factual | ARE-003 | Pendiente |
| JSON-LD | Partial | Schema.org | Organization/WebSite completos | ARE-002 | Pendiente |
| Metadata | Partial, falta image | Open Graph | og:image/url + Twitter | ARE-002 | Pendiente |
| Organization | Partial | Schema.org | email y región ya publicados | ARE-002 | Pendiente |
| Link headers | Fail | RFC 8288/RFC 9727 | relaciones registradas | ARE-010 | Pendiente |
| DNS-AID | Fail | I-D dnsaid-02, activo, no RFC | cambio DNS autorizado | DNS público | **Bloqueado: acceso GoDaddy/DNSSEC** |
| Content Signals | Fail | draft expirado + convención Cloudflare | postura conservadora | ARE-011 | Pendiente |
| API Catalog | Fail HTML | RFC 9727/RFC 9264 | linkset JSON exacto | ARE-010 | Pendiente |
| OAuth discovery | Fail | RFC 8414/OIDC | No aplicar: no AS para agentes | ARE-018 | N/A |
| Protected Resource | Fail | RFC 9728 | No aplicar: API agente pública | ARE-018 | N/A |
| Auth.md | Fail | propuesta WorkOS | No aplicar: sin registro agente | ARE-018 | N/A |
| MCP card | Fail | SEP-2127/ext experimental + scanner | tarjeta de endpoint real | ARE-013 | Pendiente |
| MCP runtime | No detectado | MCP 2025-06-18 | Streamable HTTP real | ARE-012 | Pendiente |
| Agent Skills | Fail | draft v0.2.0 | index + digest real | ARE-014 | Pendiente |
| WebMCP | Fail | W3C CG Draft 2026-09-17 | registerTool feature detect | ARE-015 | Pendiente |
| ARD | Fail | propuesta v0.91 | ai-catalog real | ARE-016 | Pendiente |
| A2A card/runtime | Fallo nuevo | A2A vigente | card + message/send real | ARE-017 | Pendiente |
| Web Bot Auth | Neutral/HTML | Cloudflare experimental | No aplicar: sin firma saliente | ARE-018 | N/A |
| Commerce | Neutral | Scanner `isCommerce=false` | No implementar | ARE-018 | N/A |

## DNS-AID

No publicar registros hasta validar la sintaxis final con el proveedor y contar con autorización. El draft activo es `draft-mozleywilliams-dnsop-dnsaid-02`, expira 2026-11-28 y no tiene estatus de RFC. El destino será exclusivamente el MCP/A2A/índice realmente desplegado en `buscotrabajo.co`; no se inventarán hosts, claves o endpoints. Registrar aquí el valor exacto aplicado, TTL, estado DNSSEC y consultas DoH cuando exista acceso.

## Rendimiento protegido

Las respuestas HTML/Markdown negociadas con `Accept` usan `Cache-Control: private, no-store`. Cloudflare no incorpora `Accept` en la clave de caché de este dominio, por lo que conservar una respuesta compartida permitiría que HTML y Markdown se contaminen entre sí aun con `Vary: Accept`. Es contenido estático ligero y no consulta la base; `/dashboard` conserva íntegramente su LRU/SWR y su caché de edge.

No modificar `src/lib/stale-while-revalidate-cache.ts` ni las constantes 5m/6h/64 de `job-repository.ts`. Confirmar proceso frío, warmup CO/VE, timeout máximo 20s, `dashboard_cache_warmed`, URL única con `cf-cache-status: MISS`, duración Render y total externo. Baseline: Render 92/12/9 ms; externo 480/273/273 ms después de `d67fc32`.

## Verificación local

Ejecutar test dedicado, unit, integration, baseline, SEO, dashboard filters, companies search, build, TypeScript, lint enfocado/global y `git diff --check`. Probar cada ruta con status, Content-Type, CORS, Cache-Control, Vary, cuerpo y schema. Ejecutar MCP initialize/list/call y A2A message/send. Capturar home/trust/docs y verificar ausencia de errores de consola.

## Despliegue y rollback

Antes de commit/push/deploy: diff completo, cero CV Generator, cero cambios de planes/servicios. Publicar por el flujo seguro del repo, esperar Render Live, inspeccionar startup y medir dashboard MISS. Rescanear ambos evaluadores hasta que no queden fallos aplicables corregibles.

Rollback: revertir el commit de esta fase. No hay migraciones ni datos persistentes. Los recursos experimentales pueden retirarse por módulo/ruta sin afectar dashboard, autenticación, pagos o scraping.

## Resultado final

Pendiente de implementación, despliegue y rescaneos. Esta sección debe registrar scores, URLs canónicas de reportes, commit desplegado, estado Render, costos/planes verificados, métricas antes/después y bloqueos externos.
