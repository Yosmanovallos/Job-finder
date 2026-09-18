# Diseño — Agent Readiness 100

## 1. Contratos

La API nueva vive bajo `/api/v1` y solo expone tres GET. Toda salida de vacante pasa por una allowlist; nunca serializa filas internas. `limit` queda entre 1 y 50, `offset` entre 0 y 5000, textos tienen longitud máxima y arrays un máximo de 10 valores. País, modalidad y frescura usan enums. Los errores usan `{ error: { code, message, resolution, requestId, details? } }`.

MCP vive en `/mcp`, sin sesión y sin SSE server-push. Implementa Streamable HTTP JSON para `initialize`, `tools/list`, `tools/call` y acepta notificaciones con 202. GET responde 405 porque no ofrece un stream SSE. Requiere el Accept normativo y rechaza Origin ajeno al origen productivo. Sus tres tools llaman las mismas funciones acotadas de la API, no hacen HTTP interno.

A2A vive en `/a2a`. Solo implementa `message/send`, no tareas persistentes, streaming, push ni cancelación. Acepta un DataPart estructurado para `search_jobs`, `get_job` o `list_supported_countries`; nunca interpreta texto libre ni ejecuta instrucciones incluidas en vacantes.

WebMCP registra esas mismas tres capacidades si `navigator.modelContext.registerTool` existe. Las marca read-only y como salida con contenido no confiable. Navegadores sin soporte no cambian.

## 2. Contenido y negociación

Home, docs y trust pages usan contenido estático derivado de texto que ya existe en la aplicación. La home sin JS supera 500 caracteres, contiene un único H1 y H2 secuenciales, y enlaza a docs, sitemap y llms.txt. El cliente React reemplaza el snippet con el diseño actual mediante `createRoot`, como ya ocurre con dashboard y páginas SEO.

`Accept: text/markdown` se selecciona solo cuando el tipo tiene preferencia positiva. La variante Markdown usa `text/markdown; charset=utf-8`; HTML sigue siendo el default. `Vary` combina `Accept` con `Accept-Encoding` en vez de sobrescribirlo. Los cuerpos son constantes precalculadas.

## 3. Descubrimiento

- OpenAPI 3.1.2 describe únicamente `/api/v1/jobs`, `/api/v1/jobs/{jobId}`, `/api/v1/countries` y `/api/health`.
- El API Catalog sigue RFC 9727 y serialización JSON de RFC 9264, con profile de RFC 9727.
- Link headers usan relaciones registradas `api-catalog`, `service-desc`, `service-doc` y `describedby` conforme a RFC 8288.
- Agent Skills usa el draft v0.2.0 y digest SHA-256 del artefacto realmente servido.
- ARD usa la propuesta v0.91; se trata como experimental y se limita a recursos reales.
- MCP Server Card es experimental. La ruta de compatibilidad exigida por el escáner describe el transporte real y no sustituye `tools/list`.
- A2A Agent Card anuncia solo `message/send` y capacidades realmente probadas.

## 4. Autenticación y confianza

Las APIs para agentes son públicas y no requieren autenticación. No se publican metadatos OAuth/OIDC, Protected Resource Metadata, Auth.md ni JWKS de Web Bot Auth. Las cuentas humanas siguen usando Supabase, pero no existe registro ni provisión de credenciales para agentes externos.

La organización usa el nombre, URL, logo, correo público y ubicación regional ya publicados en la aplicación. No se agrega dirección de calle, teléfono, identidad legal, horario ni política nueva.

## 5. Rendimiento y costo

Los documentos estáticos se construyen una vez al cargar el módulo. API, MCP, A2A y WebMCP reutilizan `getJobsPage` y su LRU SWR existente. No hay procesos residentes adicionales, servicios nuevos ni generación por solicitud de OpenAPI/JSON-LD/skills.

`src/lib/stale-while-revalidate-cache.ts`, constantes 5m/6h/64, warmup de 24 vacantes CO/VE, timeout de 20s y evento `dashboard_cache_warmed` no se modifican.

## 6. Seguridad

- Solo GET en REST y operaciones read-only en MCP/A2A/WebMCP.
- Body máximo 64 KiB en protocolos JSON-RPC.
- Rate limit general existente aplica a `/api/v1`; MCP/A2A reciben límite dedicado usando el mismo monitor.
- Texto de vacantes se devuelve como datos no confiables y nunca activa herramientas.
- Sin stack traces, SQL, secretos, tokens ni PII.
- CORS `*` solo para documentos y API pública GET; MCP/A2A validan Origin.

## 7. Rollback

Revertir el commit de esta fase elimina las nuevas rutas y restaura el fallback anterior. No hay migraciones, datos persistentes, secretos ni recursos de infraestructura que revertir. Si un estándar experimental causa incompatibilidad, sus rutas pueden retirarse de forma independiente sin afectar dashboard, scraping, autenticación o pagos.