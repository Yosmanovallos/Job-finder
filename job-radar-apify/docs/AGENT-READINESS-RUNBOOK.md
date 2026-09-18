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
| Protected Resource | Fail | RFC 9728 | `/.well-known/oauth-protected-resource`, `resource` = origen | ARE-019 | Implementado 2026-09-18 |
| Auth.md | Fail | propuesta WorkOS | `/auth.md` autocontenido, sin registro de agentes | ARE-019 | Implementado 2026-09-18 |
| MCP card | Fail | SEP-2127/ext experimental + scanner | tarjeta de endpoint real | ARE-013 | Pendiente |
| MCP runtime | No detectado | MCP 2025-06-18 | Streamable HTTP real | ARE-012 | Pendiente |
| Agent Skills | Fail | draft v0.2.0 | index + digest real | ARE-014 | Pendiente |
| WebMCP | Fail | W3C CG Draft 2026-09-17 | registerTool feature detect | ARE-015 | Pendiente |
| ARD | Fail | propuesta v0.91 | ai-catalog real | ARE-016 | Pendiente |
| A2A card/runtime | Fallo nuevo | A2A vigente | card + message/send real | ARE-017 | Pendiente |
| Web Bot Auth | Neutral/HTML | Cloudflare experimental | No aplicar: sin firma saliente | ARE-018 | N/A |
| Commerce | Neutral | Scanner `isCommerce=false` | No implementar | ARE-018 | N/A |

## OAuth: por qué publicamos RFC 9728 y no OIDC Discovery

`verifySession` (`src/auth/verify-session.ts`) valida tokens Bearer reales emitidos por el proveedor OIDC gestionado de Supabase, así que BuscoTrabajo **sí** es un resource server y RFC 9728 aplica de verdad. `/.well-known/oauth-protected-resource` declara `resource` = `https://buscotrabajo.co` (RFC 9728 §3.3: el identificador debe ser idéntico a aquel en el que se insertó el sufijo well-known; servido en la raíz, va sin componente de ruta) y nombra al emisor en `authorization_servers`.

BuscoTrabajo **no** es un authorization server y por eso `/.well-known/openid-configuration` y `/.well-known/oauth-authorization-server` devuelven 404 a propósito, con aserción en las pruebas. RFC 8414 §3.3 y OIDC Discovery §4.3 exigen que el `issuer` del documento sea idéntico al identificador desde el que se descargó; un documento servido en `buscotrabajo.co` que declarase el issuer de Supabase **debe ser rechazado** por todo cliente conforme, de modo que sería a la vez falso e inútil. Los metadatos reales del emisor viven en `https://wneeisleyngulowfcicp.supabase.co/auth/v1/.well-known/openid-configuration` (verificado en vivo: `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, `grant_types_supported`).

El check `oauthDiscovery` de IsItAgentReady sólo puede aprobarse si `buscotrabajo.co` es su propio issuer. Ninguna opción legítima lo consigue: el dominio personalizado de Supabase (add-on de pago) movería el issuer a un subdominio, no a la raíz escaneada, y construir un authorization server propio está expresamente prohibido por el encargo. Queda como no-pase documentado, no como pendiente.

Pendiente opcional: añadir `WWW-Authenticate: Bearer resource_metadata="…"` a las ~18 respuestas 401 de `src/server.ts` (RFC 9728 §5.1, opcional para el escáner). Se omitió para no tocar rutas privadas de cuenta/CV en este cambio.

## DNS-AID

Draft activo `draft-mozleywilliams-dnsop-dnsaid-02` (expira 2026-11-28, sin estatus de RFC). El skill del escáner exige registros **SVCB o HTTPS** en ServiceMode bajo `_agents`; el §4 del draft menciona TXT sólo como fallback explícitamente indeseable y **sin formato de RDATA definido**, y el §5.9 difiere a trabajo futuro la variante TXT en JSON. No existe formato contra el que implementar, así que no se inventa uno para disparar `txtIndexEntryCount`.

Bloqueo real y concreto: `buscotrabajo.co` usa los nameservers de GoDaddy (`ns39/ns40.domaincontrol.com`) y **la gestión DNS de GoDaddy no ofrece los tipos SVCB/HTTPS ni DNSSEC** para esta zona (`DS` vacío, `AD=false` en las consultas DoH). La zona actual es mínima: `A buscotrabajo.co → 216.24.57.1` (Render), `CNAME www → job-radar-apify.onrender.com`, un TXT de verificación de Google y **ningún registro MX**.

Por tanto el desbloqueo requiere una decisión del propietario: mover los nameservers a un proveedor con soporte SVCB + DNSSEC (Cloudflare DNS lo hace en su plan gratuito, sin coste adicional y sin tocar Render). Al no haber MX, una migración de zona no pone en riesgo el correo. Registros a publicar una vez tomada la decisión, apuntando sólo a endpoints ya desplegados:

```dns
_mcp._agents.buscotrabajo.co.   3600 IN SVCB 1 buscotrabajo.co. alpn="mcp,h2" port=443 mandatory=alpn,port
_a2a._agents.buscotrabajo.co.   3600 IN SVCB 1 buscotrabajo.co. alpn="a2a,h2" port=443 mandatory=alpn,port
_index._agents.buscotrabajo.co. 3600 IN SVCB 1 buscotrabajo.co. alpn="h2" port=443 mandatory=alpn,port
```

Registrar aquí el valor exacto aplicado, TTL, estado DNSSEC y las consultas DoH de verificación cuando exista acceso autorizado a la zona.

## Rendimiento protegido

Las respuestas HTML/Markdown negociadas con `Accept` usan `Cache-Control: private, no-store`. Cloudflare no incorpora `Accept` en la clave de caché de este dominio, por lo que conservar una respuesta compartida permitiría que HTML y Markdown se contaminen entre sí aun con `Vary: Accept`. Es contenido estático ligero y no consulta la base; `/dashboard` conserva íntegramente su LRU/SWR y su caché de edge.

No modificar `src/lib/stale-while-revalidate-cache.ts` ni las constantes 5m/6h/64 de `job-repository.ts`. Confirmar proceso frío, warmup CO/VE, timeout máximo 20s, `dashboard_cache_warmed`, URL única con `cf-cache-status: MISS`, duración Render y total externo. Baseline: Render 92/12/9 ms; externo 480/273/273 ms después de `d67fc32`.

## Verificación local

Ejecutar test dedicado, unit, integration, baseline, SEO, dashboard filters, companies search, build, TypeScript, lint enfocado/global y `git diff --check`. Probar cada ruta con status, Content-Type, CORS, Cache-Control, Vary, cuerpo y schema. Ejecutar MCP initialize/list/call y A2A message/send. Capturar home/trust/docs y verificar ausencia de errores de consola.

## Verificación de producción — 2026-09-18

Los commits `f83ed4a` y `6a9ad44` están integrados en `main` y Render sirve las rutas nuevas. El smoke HTTP verificó HTML sustancial, Markdown y 404 real en ambas variantes, OpenAPI, REST público con catálogo real, llms.txt, robots, API Catalog RFC 9727, ARD, Agent Skills con digests SHA-256, MCP `initialize`/`tools/list`/`tools/call` y A2A `message/send`. La misma URL solicitada primero como HTML y luego como Markdown devolvió las dos variantes correctas con `Cache-Control: private, no-store`, `Vary: Accept, Accept-Encoding` y `cf-cache-status: BYPASS`.

Una URL única de `/dashboard` devolvió `cf-cache-status: MISS` en 316 ms externos. La fase no alteró el LRU/SWR, warmup ni configuración de Render.

IsItAgentReady rescaneó a **73/100 (nivel 5, Agent-Native)**: Discoverability 3/4, Content 1/1, Bot Access Control 2/2 y API/Auth/MCP/Skill Discovery 5/8. Sus únicos fallos son DNS-AID y OAuth/OIDC, OAuth Protected Resource y Auth.md. Los tres últimos no aplican: la API de agentes es pública y no existe un authorization server, registro, emisión, revocación o JWKS reales; publicarlos para subir puntuación sería metadato falso e inseguro.

DNS-AID exige acceso autorizado a la zona de GoDaddy de `buscotrabajo.co`, una decisión explícita de habilitar DNSSEC y valores SVCB/HTTPS validados contra la versión final del draft. No se publicaron registros inventados. Is Agentic recibió una solicitud de rescan, pero seguía mostrando su snapshot previo de 44/100 (01:02 UTC) tras el despliegue; no se presenta como un resultado posterior ni como evidencia de fallo de las rutas que el smoke y el otro escáner comprobaron.

## Despliegue y rollback

Antes de commit/push/deploy: diff completo, cero CV Generator, cero cambios de planes/servicios. Publicar por el flujo seguro del repo, esperar Render Live, inspeccionar startup y medir dashboard MISS. Rescanear ambos evaluadores hasta que no queden fallos aplicables corregibles.

Rollback: revertir el commit de esta fase. No hay migraciones ni datos persistentes. Los recursos experimentales pueden retirarse por módulo/ruta sin afectar dashboard, autenticación, pagos o scraping.

## Ciclo 2 — 2026-09-18 (PRM + auth.md)

Rescaneo de partida vía `POST https://isitagentready.com/api/scan`: nivel 5 (Agent-Native), 4 fallos — `discoverability.dnsAid`, `discovery.oauthDiscovery`, `discovery.oauthProtectedResource`, `discovery.authMd`. `botAccessControl.webBotAuth` y los cinco checks de commerce siguen en `neutral` (no puntúan).

Implementado en este ciclo: `/.well-known/oauth-protected-resource` (RFC 9728) y `/auth.md` autocontenido. Ambos son estáticos y se sirven desde `handleAgentReadinessRoute`, antes del fallback SPA; no consultan la base de datos y no tocan el LRU/SWR de `/dashboard`.

Verificación local sin Docker: el suite aislado exige Postgres en contenedor y Docker no está disponible en esta máquina, así que los dos recursos nuevos se validaron contra un servidor HTTP real montando sólo sus handlers — status, `Content-Type`, CORS, `resource` = origen, `authorization_servers`, `bearer_methods_supported`, H1 `auth.md`, ausencia de `undefined` — y se comprobó en vivo que el documento del emisor declara exactamente el `issuer` que publicamos. `npx tsc --noEmit` no añade ningún error en los tres archivos tocados (el resto es la línea base heredada del repo).

Techo alcanzable tras este ciclo: `oauthProtectedResource` y `authMd` deberían pasar; `dnsAid` depende de la decisión de nameservers y `oauthDiscovery` es un no-pase por diseño. El 100/100 de IsItAgentReady no es alcanzable sin publicar metadatos de authorization server falsos.

## Resultado final

Registrar aquí, tras cada despliegue: scores, URLs canónicas de reportes, commit desplegado, estado Render, costos/planes verificados, métricas antes/después y bloqueos externos.
