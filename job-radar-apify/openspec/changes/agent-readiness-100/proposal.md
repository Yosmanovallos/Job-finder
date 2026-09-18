# Agent Readiness 100 — BuscoTrabajo.co

**Estado:** aprobado por solicitud explícita del usuario el 2026-09-17. Implementación pendiente de pruebas rojas.

## Problema

Dos evaluadores externos no confiables, verificados de nuevo antes de editar, encuentran que la superficie pública de BuscoTrabajo es difícil de descubrir y usar por agentes. Is Agentic registró 44/100 el 2026-09-18T01:02:04Z. La API de IsItAgentReady registró nivel 1, “Basic Web Presence”, el 2026-09-18T01:18:28Z: pasan robots.txt, sitemap y reglas wildcard; fallan Link headers, DNS-AID, Markdown, Content Signals y nueve mecanismos de descubrimiento.

El sitio ya tiene vacantes públicas, consultas paginadas, rate limiting y caché acotado. El problema es que esas capacidades no tienen un contrato público estricto, documentación ni descubrimiento interoperable; además, rutas desconocidas sin extensión caen en el app shell con 200.

## Objetivo

Publicar una superficie read-only, acotada, verificable y consistente para agentes, sin auto-apply, sin acceso a CV, sin PII, sin anunciar OAuth o firma de bots inexistentes y sin degradar el dashboard ni aumentar el costo de Render.

## Alcance

- HTML inicial sustancial y semántico en las home regionales.
- 404 HTML/Markdown real y cierre del fallback SPA a rutas conocidas.
- OpenAPI 3.1 y API pública versionada de búsqueda, detalle y países.
- Errores JSON tipados, límites y CORS solo en recursos públicos seguros.
- Markdown negotiation, llms.txt, docs y páginas de confianza.
- Link headers, API Catalog RFC 9727/RFC 9264, Agent Skills v0.2.0 y ARD v0.91.
- MCP Streamable HTTP funcional con tools read-only.
- A2A funcional y determinístico para mensajes con DataPart de búsqueda.
- WebMCP con feature detection y tools read-only.
- Metadata y JSON-LD basados únicamente en datos públicos existentes.
- OpenSpec, pruebas, runbook, despliegue, smoke tests y rescaneos.

## Fuera de alcance

- OAuth/OIDC, Protected Resource Metadata y registro dinámico de agentes: no existe ese producto.
- Web Bot Auth: BuscoTrabajo no firma solicitudes salientes de agentes.
- Commerce: el escáner clasificó correctamente el sitio como no-commerce.
- CV Generator, auto-apply, endpoints administrativos o de escritura.
- Nuevos servicios, workers, bases de datos, planes o proveedores pagados.
- DNS-AID sin acceso autorizado al DNS de GoDaddy; se preparará el cambio exacto sin inventar acceso.

## Resultado esperado

Todos los controles aplicables pasan localmente y en producción; los no aplicables quedan ausentes de forma deliberada. DNS-AID queda aplicado solo si hay acceso real al proveedor. El dashboard conserva el LRU de 64 entradas, fresh 5 minutos, stale 6 horas, single-flight, copias defensivas, warmup CO/VE y timeout de 20 segundos.