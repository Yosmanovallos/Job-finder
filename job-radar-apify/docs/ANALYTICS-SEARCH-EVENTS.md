# Eventos de búsqueda en GA4 (2026-11-02)

Instrumentados en `src/lib/analytics.ts` y `src/sections/Dashboard.tsx`. Sin PII:
el término se pasa a minúsculas, sin tokens con `@`, sin URLs, sin series de 5 o más
dígitos (teléfonos, cédulas) y truncado a 100 caracteres (`sanitizeSearchTerm`).

| Evento | Cuándo | Parámetros |
|---|---|---|
| `search` | Llegan los resultados de un término nuevo | `search_id`, `search_term` |
| `search_results` | Llegan los resultados de cualquier combinación nueva de filtros (no en la vista por defecto) | `search_id`, `search_term`, `results_count`, `filters_active` (p. ej. `search,modality`), `modality`, `has_suggestion` |
| `select_job` | Clic en un resultado de la lista (escritorio) | `job_id`, `job_source`, `surface`, `position`, `search_id` |
| `apply_gate_open`, `outbound_apply` | Como antes | más `search_id` si hubo una búsqueda en los últimos 30 min |

`search_id` es el parámetro común del embudo: búsqueda → resultados → clic → salida.

## Lo que el usuario debe crear en GA4 (Administrar → Definiciones personalizadas)

Dimensiones con alcance de evento: `search_id`, `filters_active`, `modality`,
`has_suggestion`, `job_source`, `surface`. Métricas personalizadas: `results_count`
(estándar) y `position` (estándar). `search_term` ya es una dimensión integrada
(«Término de búsqueda»).

Cero resultados = `search_results` con `results_count = 0`.

## Advertencia

La búsqueda en el sitio de la medición mejorada (`view_search_results`) lee el
parámetro `?search=` de la URL **sin sanear**. Conviene desactivarla en
Flujos de datos → Medición mejorada → Búsqueda en el sitio, ahora que `search` la
reemplaza.
