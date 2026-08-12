# Auditoría de seguridad — 2026-08-02

Resumen de la revisión de seguridad hecha sobre 8 puntos pedidos por el
dueño del producto, qué se encontró, qué se arregló, y qué queda
pendiente. Referencia para no repetir la investigación ni perder de vista
los puntos que necesitan acción humana. No es un plan de fases nuevas —
para eso está el resto de `docs/`.

Todos los hallazgos se verificaron **empíricamente** contra el servidor
real y la base de datos de producción real (este repo no tiene una DB de
prueba separada — ver `SESSION-NOTES.md`), no solo leyendo el código.

## Resultado por punto

| # | Punto pedido | Resultado |
|---|---|---|
| 1 | API keys/secretos solo en el servidor | ✅ Bien, sin cambios |
| 2 | RLS activo en todas las tablas | ✅ Bien, sin cambios (verificado con la anon key real) |
| 3 | Variables de entorno fuera del repo | ✅ Bien, sin cambios |
| 4 | Validación/limpieza de datos del usuario | ✅ Bien, sin cambios |
| 5 | Ninguna tabla accesible públicamente por defecto | ⚠️ → ✅ Arreglado (`REVOKE`, ver abajo) |
| 6 | Autenticación en rutas protegidas | ✅ Bien, sin cambios |
| 7 | Mensajes de error sin info sensible | ⚠️ → ✅ Arreglado (5 endpoints, ver abajo) |
| 8 | Logs para detectar ataques | ❌ → 🟡 Construido desde cero (L1-L3, ver abajo) — base real, no un sistema maduro |

## 1. Secretos solo en el servidor (verificado, sin cambios)

El cliente (bundle de Vite) solo usa `import.meta.env.VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY` — ambas públicas por diseño en Supabase (la
seguridad real la da RLS, no ocultar la anon key). Confirmado:
- El entry point real del cliente (`src/index.tsx`) y todo lo que importa
  no tocan `process.env`.
- Todo `process.env.*` fuera de eso vive en scripts Node-only (CLI,
  `scripts/`, `server.ts`) que Vite nunca empaqueta.
- `vite.config.ts` no tiene ningún `define` que exponga variables extra.
- Sin claves/secretos hardcodeados en el código (grep de patrones tipo
  `sk_live`, `-----BEGIN PRIVATE KEY-----`, etc.).

## 2. RLS en todas las tablas (verificado, sin cambios)

Las 11 tablas de `public` tienen `ENABLE ROW LEVEL SECURITY` y **cero
políticas** — patrón "zero-policy" ya documentado en `schema.sql`: sin una
política que lo permita explícitamente, PostgREST (anon/authenticated)
no ve ni puede escribir ninguna fila; `postgres` (la conexión real de la
app, `src/db/client.ts`) tiene `BYPASSRLS` y no se ve afectado.

Verificado con la anon key pública real contra la API REST de Supabase:
- `SELECT` en `users`, `transactions`, `jobs`, `company_user_reviews`,
  `company_reputation`, `search_roles` → `200` con `[]` en las seis.
- `INSERT` en `company_user_reviews` → `401` con
  `"new row violates row-level security policy"` (código Postgres 42501,
  mensaje genérico, no filtra nada del schema).

## 3. Variables de entorno fuera del repo (verificado, sin cambios)

`.env`/`.env.*` están en `.gitignore` (con excepción explícita de
`.env.example`, que no tiene secretos reales). `git log --all` sobre
`**/.env*` solo tiene el commit que agregó `.env.example` — nunca se
comprometió un `.env` real al historial.

## 4. Validación y limpieza de datos del usuario (verificado, sin cambios)

- **Inyección SQL**: cada `pool.query()` en `src/db/*.ts` usa parámetros
  (`$1, $2, ...`), incluidos los INSERT batcheados (el `${...}` que
  aparece ahí es solo el texto del placeholder `$N`, nunca un valor real
  interpolado).
- **XSS**: cero usos de `dangerouslySetInnerHTML` en toda la app — React
  escapa todo por defecto (títulos de vacantes, nombres de empresa,
  comentarios de reseñas). El HTML generado en el servidor (SSR de
  `/dashboard`, `/empleos/:id`, sitemaps) pasa todo texto por
  `escapeHtml()` (`src/lib/job-seo.ts`) antes de insertarlo.
- **Validación de endpoints de escritura**: rating de reseñas (entero
  1-5), comment (string, recortado, tope 1000 chars — reforzado también a
  nivel DB con `CHECK (rating BETWEEN 1 AND 5)`), nombre de perfil
  (recortado, no vacío, tope 255), roles preferidos (array de strings,
  tope 10, cada uno tope 100 chars) — todo antes de tocar la base de
  datos.

## 5. Ninguna tabla accesible públicamente por defecto — ⚠️ ARREGLADO

**Hallazgo**: RLS bloqueaba todo hoy (punto 2), pero Supabase le otorga
por defecto `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` a
los roles `anon`/`authenticated` en cada tabla nueva de `public` —
confirmado en vivo vía `information_schema.role_table_grants`. Eso hacía
que RLS fuera la **única** capa de defensa: si en el futuro alguien
agrega una sola política permisiva a cualquier tabla (incluso sin
querer, por ejemplo debuggeando algo no relacionado desde el panel de
Supabase Studio), esos permisos ya estaban ahí esperando para exponer esa
tabla completa con la anon key pública.

**Arreglo**: `REVOKE ALL ... FROM anon, authenticated` explícito en las
11 tablas, agregado a `src/db/schema.sql` (después del bloque de
`ENABLE ROW LEVEL SECURITY`) y ya aplicado contra la base de datos real
vía `scripts/migrate.ts`. Ahora hay dos capas independientes — RLS y
permisos SQL — no una sola.

Verificado después del cambio: `SELECT count(*) FROM
information_schema.role_table_grants WHERE grantee IN ('anon',
'authenticated')` → `0` filas. La app (conexión `postgres`, sin RLS ni
estos GRANTs) sigue leyendo/escribiendo normal.

## 6. Autenticación en rutas protegidas (verificado, sin cambios)

Los 12 puntos de `server.ts` donde se llama `verifySession(req)` se
revisaron uno por uno. Las rutas de solo-lectura pública (`/api/jobs`,
`/api/jobs/:id`, `/api/companies/:slug`, SSR de `/dashboard`) usan
`session?.tier || "free"` a propósito (deben funcionar para anónimos).
Toda ruta que escribe datos o expone info privada — reseñas POST/DELETE,
`/api/me` GET/PATCH, `/api/me/roles`, `/api/transactions`,
`/api/run-scraper`, `/api/checkout/start` — tiene el guard `if (!session)
{ 401; return; }` antes de usar `session.id` en cualquier cosa.

## 7. Mensajes de error sin información sensible — ⚠️ ARREGLADO

**Hallazgo**: 5 endpoints (reseñas POST, `PATCH /api/me`, `PATCH
/api/me/roles`, `POST /api/checkout/start`, `POST /api/webhooks/wompi`)
devolvían `e?.message` directo al cliente cuando algo fallaba dentro del
`try`. La propia validación de cada ruta ya devuelve su propio mensaje
seguro antes de llegar ahí — lo que caía en ese `catch` era o bien un
`JSON.parse` roto (mensaje genérico, inofensivo) o un fallo real de base
de datos/red, cuyo mensaje crudo de Postgres puede nombrar tablas,
columnas o constraints internos.

**Arreglo**: helper `respondToUnexpectedError()` en `server.ts` —
distingue `SyntaxError` (JSON inválido, mensaje genérico seguro) de
cualquier otro error (se loguea completo con `console.error` en el
servidor, al cliente solo llega un mensaje genérico tipo "No se pudo
guardar la reseña."). Aplicado en los 5 puntos.

## 8. Logs para detectar ataques — construido desde cero (L1-L3)

No existía absolutamente nada: sin logging de requests, sin
rate-limiting, sin alertas, sin bloqueo. Se construyó en tres fases,
todas en `src/lib/security-monitor.ts` + su integración en `server.ts`:

### L1 — Rate limiting (activo ahora, sin configuración adicional)

En memoria (un `Map` por IP, sin Redis — ver limitación abajo), sliding
window:
- **120 requests/min** por IP en todo `/api/*`, excepto `/api/health`
  (los hosts lo monitorean cada pocos segundos; limitarlo generaría
  falsas alarmas de "servicio caído").
- **10 requests/min** por IP en endpoints sensibles: reseñas POST/DELETE,
  `POST /api/checkout/start`, `POST /api/run-scraper`.
- Excedido el límite → `429` con `Retry-After`, mensaje genérico.

Verificado en vivo: 125 requests seguidos a `/api/companies/search` →
exactamente 120 en `200`, el request #121 en adelante `429`.

**Bug real encontrado y corregido en vivo, 2026-08-08** (durante la
verificación manual de Fase 7 de `docs/CV-GENERATION-PLAN.md`, no una
regresión de esta auditoría — el código de L1 no cambió desde el
`✅` original de arriba, solo se descubrió tarde): `checkRateLimit`
usaba un único `number[]` de timestamps por IP compartido entre
**todos** los llamadores, así que el límite general (120/min, contado en
cada `/api/*`) y el límite sensible (10/min, solo en checkout/reseñas/CV)
eran en secreto el mismo contador. Una sesión normal de navegación
(un puñado de GETs corrientes: `/api/jobs`, `/api/me`, polling del
dashboard) ya dejaba ese contador compartido cerca del límite, así que
la primera acción sensible real de la sesión (el primer clic en
"Generar CV", o en producción el primer `POST /api/checkout/start`) caía
en `429` con **cero** solicitudes sensibles hechas — el mismo bug
afectaba el checkout de pago en producción, no solo esta feature nueva.
Arreglado: `IpState.requestTimestamps` pasó de `number[]` a
`Map<scope, number[]>`, `checkRateLimit` ahora exige un `scope: string`
explícito (`"general"` vs `"sensitive"`, cada llamador en `server.ts`
pasa el suyo). Regresión cubierta en `test:rate-limiting` (Test 0, prueba
pura de la función, sin servidor).

### L2 — Alertas (construido, **requiere una acción tuya para activarse**)

Cuando una IP acumula **20 eventos sospechosos** (401, 403, o un rechazo
por rate-limit) en una ventana de **5 minutos**, se dispara una alerta vía
webhook (formato de Discord: `POST {content: "..."}`).

**No está activo todavía.** Sin la variable de entorno
`SECURITY_ALERT_WEBHOOK_URL` configurada, la alerta solo se registra con
`console.error` en el servidor — nadie se entera en tiempo real. Para
activarla:
1. En un canal de Discord: clic derecho → Integrations → Webhooks → New
   Webhook → Copy Webhook URL (2 minutos, sin cuenta nueva ni costo).
2. Agregar `SECURITY_ALERT_WEBHOOK_URL=<esa URL>` al `.env` de
   producción (nunca al repo).

Si en algún momento se usa Slack en vez de Discord, el payload cambia de
`{content: ...}` a `{text: ...}` — hay que ajustar
`sendSecurityAlert()` en `security-monitor.ts`.

### L3 — Bloqueo automático temporal (activo ahora)

Al cruzar **40 eventos sospechosos en 5 minutos**, esa IP queda
**bloqueada 15 minutos** — cualquier request suyo (a cualquier ruta,
incluso `/api/health`) recibe `429` inmediatamente, antes de tocar
cualquier lógica de negocio.

**Deliberadamente temporal, nunca una lista de baneo permanente**: los
umbrales (20/40 eventos, ventanas de 5/15 min) se eligieron sin haber
visto tráfico real de producción — son un punto de partida razonable, no
una calibración basada en datos. Un umbral mal elegido se autocorrige
solo en 15 minutos en vez de dejar a un usuario real (o a ti mismo,
probando la app) bloqueado sin forma de desbloquearse.

Verificado en vivo: tras cruzar el umbral, hasta `/api/health` (exento
del límite general) empezó a responder `429` — confirma que el check de
bloqueo corre antes que cualquier otra cosa, sin excepciones.

### Limitaciones conocidas de L1-L3 (aceptadas, no bugs)

- **En memoria, no compartido entre instancias**: si el servidor alguna
  vez corre en más de una instancia (escalado horizontal), cada una
  cuenta por separado — un límite de "120/min" se vuelve "120/min por
  instancia". Hoy corre como un solo proceso, así que no aplica todavía.
- **`x-forwarded-for` como fuente de la IP real**: confiable solo si la
  plataforma de hosting (Render u otra) actúa como proxy de confianza que
  fija ese header ella misma. Si algún día queda detrás de algo que
  reenvíe ciegamente un `X-Forwarded-For` puesto por el propio cliente,
  se vuelve falsificable (un atacante podría rotar IPs falsas para
  saltarse el límite, o hacer que el sistema bloquee la IP de un usuario
  real). Vale la pena revisar esto contra la configuración real de
  hosting antes de confiar más en el sistema.
- **No es un WAF ni reemplaza protección de red**: si el hosting está
  detrás de Cloudflare o similar, activar su protección/rate-limiting a
  nivel de borde es una capa adicional recomendada, más difícil de
  saltarse que cualquier cosa a nivel de aplicación.
- **Umbrales sin calibrar con tráfico real** — ver nota de L3 arriba.
  Ajustables en `src/lib/security-monitor.ts`:
  `GENERAL_API_RATE_LIMIT`, `SENSITIVE_RATE_LIMIT`, `ALERT_THRESHOLD`,
  `BLOCK_THRESHOLD`, `BLOCK_DURATION_MS`.

## Verificación y despliegue

- Build limpio, 3 suites de test HTTP reales en verde:
  `npm run test:company-reviews`, `npm run test:companies-search`,
  `npm run test:rate-limiting` (esta última nueva, cubre L1-L3).
- Los cambios de base de datos (tabla `company_user_reviews`, los
  `REVOKE`) ya están aplicados directamente contra producción — no
  dependen del deploy del código.
- Los cambios de código se commitearon y pushearon a `origin/main` en 3
  commits separados (`236273d`, `6c953ec`, `39572cc`) — confirmar en el
  dashboard del hosting que cada deploy compiló y se activó bien.

## Pendiente (acción humana, no del código)

1. **Configurar `SECURITY_ALERT_WEBHOOK_URL`** (ver sección L2 arriba) —
   sin esto, las alertas no te llegan a ningún lado.
2. **QA manual del flujo de reseñas autenticado** (escribir/ver/editar/
   borrar con una cuenta real) — nunca se pudo probar automatizado por el
   bloqueo de "Confirm email" de Supabase en signups de prueba.
3. Revisar los umbrales de L1-L3 después de unas semanas de tráfico real
   — ajustar si generan falsos positivos o si dejan pasar abuso real.
