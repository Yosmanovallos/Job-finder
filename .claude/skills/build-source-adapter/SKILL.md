---
name: build-source-adapter
description: Diseña e implementa un adaptador de fuente de vacantes usando API-first, fixtures sanitizados, pruebas contractuales y evidencia de procedencia.
---

# Objetivo

Implementar un solo adaptador SourceAdapter.

# Proceso

1. Leer la documentación oficial y registrar URL, formato, paginación, límites y términos relevantes.
2. Verificar si existe API/feed antes de considerar HTML o navegador.
3. Crear documento de catálogo de fuente.
4. Crear fixtures mínimos: listado, detalle, vacío, error, cambio de esquema.
5. Implementar discover/fetch/extract/verify.
6. Mapear al esquema canónico sin inventar campos.
7. Añadir rate limit, timeout, retry y circuit breaker.
8. Añadir unit tests y contract tests.
9. Ejecutar lint, typecheck y pruebas del paquete.
10. Entregar reporte con cobertura, limitaciones y señales de salud.

# Prohibiciones

- No CAPTCHA bypass.
- No credenciales en fixtures.
- No selectores frágiles si existe JSON.
- No cambios fuera del módulo salvo interfaces previamente aprobadas.
