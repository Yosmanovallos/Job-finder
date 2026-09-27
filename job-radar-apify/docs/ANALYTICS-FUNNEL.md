# Embudo GA4 de BuscoTrabajo

Implementado en la fase de recuperación SEO de septiembre de 2026. Ningún evento envía correo, nombre, ID de usuario, texto del CV ni la URL externa de la vacante.

## Eventos

| Evento                | Momento                                | Parámetros propios                         |
| --------------------- | -------------------------------------- | ------------------------------------------ |
| `page_view`           | Navegación interna de la SPA           | `page_path`, `page_location`, `page_title` |
| `view_job`            | La API entrega una vacante pública     | `job_id`, `job_source`, `surface`          |
| `apply_gate_open`     | Visitante anónimo intenta aplicar      | `job_id`, `job_source`, `surface`          |
| `outbound_apply`      | Salida voluntaria a la fuente original | `job_id`, `job_source`, `surface`          |
| `sign_up`             | Supabase acepta un registro            | `method` (`email` o `google`)              |
| `login`               | Supabase acepta un acceso              | `method` (`email` o `google`)              |
| `onboarding_complete` | Se guardan u omiten los roles          | `role_count`, `skipped`                    |

Todos incluyen `page_path` y, cuando existen en la sesión, únicamente `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` y `utm_term`.

## Embudo recomendado en GA4

1. `page_view` en `/empleos/...`
2. `view_job`
3. `apply_gate_open`
4. `sign_up`
5. `onboarding_complete`
6. `outbound_apply`

`outbound_apply`, `sign_up` y `onboarding_complete` deben marcarse como eventos clave después de validar en DebugView que los payloads llegan a la propiedad `G-QV1E0K4KZF`.
