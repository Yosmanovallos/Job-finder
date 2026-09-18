# Delta spec — Agent Readiness

## ARE-001 — Contenido sin JavaScript

`GET /` y `GET /ve` MUST responder HTML con un H1, headings secuenciales y al menos 500 caracteres de texto significativo y visible sin ejecutar JavaScript.

## ARE-002 — Metadata y entidad

La home MUST tener canonical, lang, título, descripción, og:type, og:url, og:image accesible y JSON-LD Organization/WebSite con nombre, descripción, URL y datos de contacto/ubicación ya publicados.

## ARE-003 — Trust anchors

`/about`, `/contact` y `/privacy` MUST resolver contenido sustancial, factual y enlazado. No MUST inventar identidad legal, dirección de calle, teléfono ni retención.

## ARE-004 — 404 real

Una ruta desconocida MUST devolver 404. Con `Accept: text/markdown` MUST devolver Markdown de al menos 20 caracteres, tipo correcto y links de recuperación. Las rutas SPA conocidas MUST seguir resolviendo 200.

## ARE-005 — Markdown negotiation

La home y las páginas públicas estáticas MUST mantener HTML por defecto y devolver Markdown no vacío cuando se negocia. `Vary` MUST contener Accept y conservar Accept-Encoding.

## ARE-006 — Errores API

Toda ruta desconocida bajo `/api/` y todo error de `/api/v1` MUST ser JSON con código estable, mensaje, resolución y requestId, status y Content-Type correctos, sin detalles sensibles.

## ARE-007 — API pública

La API MUST ofrecer listado, detalle y países read-only; usar allowlist de salida, límites de paginación y longitud, enums y el rate limit existente. No MUST exponer CV, PII, administración, escritura ni scraping bajo demanda.

## ARE-008 — OpenAPI

`/openapi.json` MUST ser OpenAPI 3.1 válido y describir solo endpoints reales. Cada operación MUST tener operationId único, descripción, inputs tipados, responses y errores tipados.

## ARE-009 — Documentación e instrucciones

`/docs` y `/llms.txt` MUST explicar propósito, cuándo usar/no usar, parámetros, límites, errores, ejemplos, atribución, no invención y no auto-apply; MUST enlazar API, OpenAPI y sitemap.

## ARE-010 — Web Linking y API Catalog

La home MUST emitir Link conforme a RFC 8288. `/.well-known/api-catalog` MUST cumplir RFC 9727/RFC 9264 y soportar GET/HEAD con media type y relaciones correctas.

## ARE-011 — Content Signals

robots.txt MUST conservar sus reglas y declarar `ai-train=no`, `search=yes`, `ai-input=yes`, identificando el mecanismo como experimental.

## ARE-012 — MCP

`/mcp` MUST implementar Streamable HTTP para initialize, tools/list y tools/call. Solo MUST anunciar y ejecutar búsqueda, detalle y países. MUST imponer body, origen, rate limit, schemas y errores JSON-RPC.

## ARE-013 — MCP Server Card

La tarjeta experimental MUST describir el endpoint y capacidades reales. La lista autoritativa de tools MUST seguir siendo `tools/list`.

## ARE-014 — Agent Skills

El índice v0.2.0 MUST listar artefactos accesibles cuyo digest SHA-256 coincida con los bytes servidos. Las instrucciones MUST ser read-only y rechazar auto-apply/invención.

## ARE-015 — WebMCP

La home MUST registrar tools únicamente cuando `navigator.modelContext.registerTool` exista. Navegadores sin soporte MUST permanecer intactos. Todos los tools MUST ser read-only y acotados.

## ARE-016 — ARD

`/.well-known/ai-catalog.json` MUST cumplir la propuesta vigente, CORS público seguro, identificadores del host, MIME y 2-5 queries representativas por entrada. Solo MUST referenciar recursos reales.

## ARE-017 — A2A

La tarjeta A2A MUST anunciar una interfaz real. `/a2a` MUST procesar `message/send` con DataPart estructurado para las mismas capacidades read-only, sin interpretar texto libre ni persistir tareas.

## ARE-018 — No capacidades falsas

OAuth/OIDC, Protected Resource Metadata, Auth.md y Web Bot Auth MUST permanecer ausentes mientras no exista autenticación/provisión de agentes o firma saliente real. Commerce MUST permanecer no aplicable.

## ARE-019 — Rendimiento

La implementación MUST preservar LRU 64, fresh 5m, stale 6h, single-flight, copias defensivas, warmup de 24 CO/VE, timeout 20s y evento `dashboard_cache_warmed`. Documentos estáticos MUST precalcularse y no MUST crear procesos o servicios.

## ARE-020 — Costos y aislamiento

Render MUST conservar `job-radar-apify` Starter USD 7, automatización social Free y gasto previsto inferior a USD 10. El diff MUST contener cero cambios de CV Generator.