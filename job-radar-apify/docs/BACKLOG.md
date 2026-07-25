# Backlog — job-radar-apify

Pendientes detectados durante el trabajo de auth/cuenta que no bloquean la
fase en curso, pero hay que retomar antes de depender de ellos en producción.

## Infraestructura de correo (Supabase Auth)

**Qué:** Supabase usa por defecto un proveedor de correo propio con un límite
de envíos muy bajo por hora. Lo confirmamos el 2026-07-25 corriendo
`npm run test:password-reset`: tras unas pocas señales de prueba (signup +
resend + reset) el proyecto empezó a devolver `email rate limit exceeded` en
`signUp`.

**Por qué importa:** los correos de confirmación de registro y de
recuperación de contraseña (Fase 1 del flujo de auth) dependen de que estos
correos salgan. Con usuarios reales registrándose, ese límite por defecto se
agota rápido y la gente deja de recibir confirmaciones/resets — se ve como
"no me llegó el correo", indistinguible de un bug, pero es configuración de
infraestructura.

**Qué hacer cuando se retome:** configurar un proveedor SMTP propio en
Supabase → Authentication → Emails → SMTP Settings (Resend, Postmark o
SendGrid son las opciones típicas; Resend tiene tier gratuito generoso y es
sencillo de conectar). Una vez configurado, no hace falta cambiar código —
Supabase empieza a usar ese SMTP automáticamente para todos los correos de
auth (signup, reset, magic link).

**Debe estar resuelto antes de:** anunciar el producto públicamente o correr
cualquier campaña de adquisición (ver `product-vision-scaling` en memoria) —
si el correo de confirmación no llega, el usuario nunca puede completar el
registro.

## Separar el scraper del proceso web (RESUELTO — 2026-07-25)

**Qué era:** `src/queue/cron.ts` + `src/queue/scheduler.ts` corrían el
scraping (hasta 12 roles cada 5 min, 3 en paralelo) dentro del mismo proceso
Node que sirve el sitio web y el login. El 2026-07-25, en producción (Render
free tier), esto causó `FATAL ERROR: Reached heap limit — JavaScript heap
out of memory` (exit code 134 / SIGABRT) de forma recurrente — cada vez que
el proceso moría, se caía TODO: login, dashboard, checkout, todo, no solo el
scraper.

**Cómo quedó resuelto:** el scraping corre por completo fuera del proceso
web, vía GitHub Actions (`.github/workflows/scrape-jobs.yml`, cada 15 min,
gratis por repo público) invocando `job-radar-apify/scripts/run-scrape-tick.ts`
— un script de un solo ciclo, sin reintentos internos (un rol que supera su
timeout de 5 min simplemente queda "debido" para el siguiente tick, en vez de
reintentarse en el mismo proceso). Escribe a la misma Postgres/Supabase que
lee el servicio web. `src/server.ts` ya no importa `queue/scheduler.js` ni
`queue/cron.js` en absoluto — `queue/cron.ts` se borró, `queue/scheduler.ts`
quedó reducido a solo `DEFAULT_ROLES_200`. `ENABLE_CRON` se quitó del
`render.yaml` (ya no existe el código que lo leía). El botón manual
`/api/run-scraper` ya no genera un subproceso en el web dyno — solo marca el
rol como "debido ahora" en Postgres (`markRoleForImmediateRescan`) para que
lo recoja el siguiente tick programado. El workflow tiene un guard de
concurrencia (`concurrency: group, cancel-in-progress: false`) para que dos
ticks no se solapen escaneando los mismos roles a la vez.

**Por qué importa:** es la arquitectura correcta que ya estaba prevista en la
visión de producto (ver `product-vision-scaling` en memoria): "queue con
concurrencia controlada... los usuarios leen del store, nunca disparan
scrapes en vivo". Con 30 roles ya tumbaba el proceso; con 200 hubiera sido
peor — con la separación, el límite de memoria del runner de GitHub Actions
ya no puede afectar el servicio web en absoluto.

**Pendiente relacionado, no bloqueante:** `DEFAULT_ROLES_200` (en
`src/queue/scheduler.ts`) hoy solo tiene 30 roles, no 200 — escalar a la lista
completa es seguro ahora que el scraping no comparte proceso con la web, pero
sigue limitado por lo que Indeed/Workana toleren (ver sus entradas en
`docs/source-catalog/`) y por el volumen real que soporte el runner gratuito
de GitHub Actions.

## GitHub Action del Social Auto-Publisher rota (falla desde antes del 2026-07-25)

**Qué:** `.github/workflows/social-publish.yml` (cron cada 15 min) falla
siempre con `Error: Cannot find module './src/social/publisher.js'`.
Confirmado con `gh run list` que viene fallando desde al menos las 04:38 UTC
del 2026-07-25 — no relacionado con el trabajo de auth de esta sesión.

**Por qué pasa:** el step "Run Social Auto-Publisher Worker" corre
`npx tsx -e "import { publishPendingDigests } from './src/social/publisher.js'; ..."`
— un import inline vía `-e`. El archivo real es `publisher.ts` (no hay
compilado `.js`). En cualquier archivo real del repo el mapeo `.js` → `.ts`
de `tsx` funciona (`tsx src/server.ts` importando `"./db/job-repository.js"`,
por ejemplo), pero con `-e` (código inline, sin archivo real de por medio) esa
resolución de rutas relativas no aplica igual y truena con "Cannot find
module".

**Qué hacer cuando se retome:** reemplazar el `-e` inline por un script real,
p. ej. `job-radar-apify/scripts/run-social-publisher.ts` que haga el import y
llame a `publishPendingDigests()`, y cambiar el step del workflow a
`npx tsx scripts/run-social-publisher.ts` — mismo patrón que ya usa el resto
del repo (`tsx src/server.ts`, `tsx src/index.ts`) en vez del inline eval.

**Debe estar resuelto antes de:** depender de que los digests a redes
sociales se publiquen solos — ahora mismo la publicación automática lleva
horas (probablemente días) sin correr nunca con éxito.

## Filtros del Dashboard — reporte sin reproducir aún (2026-07-25)

**Qué:** el usuario reportó que "ninguno de los filtros del Dashboard funciona
correctamente" (Fuente/Portal, Modalidad, Frescura/Publicación, búsqueda de
texto, Ver Guardadas, Ver Aplicadas), probado sobre las ~100 vacantes que
había antes de que la tabla `jobs` quedara vacía por un test. No se pudo
reproducir en vivo en esta sesión: no hay navegador headless disponible en
este entorno (Playwright falla por librerías del sistema faltantes —
`libnspr4.so` — y no hay sudo sin contraseña para instalarlas), y
`tests/validate-dashboard-filters.ts` no sirve para diagnosticar porque
reimplementa su propia copia de la lógica de filtrado en vez de importar la
real de `src/sections/Dashboard.tsx` — pasa siempre, sin importar si el
código real está roto.

**Bug concreto ya confirmado (parcial, no explica el reporte completo):** el
filtro de Modalidad (`handleFilterChange` en `Dashboard.tsx`) lee
`job.location`, pero para usuarios **free** esa vacante <48h llega con
`location: null` por el enmascarado del paywall (`maskLockedFields`). Con
`location` nulo, el filtro "Remoto"/"Híbrido" siempre falla y "Presencial"
siempre pasa, sin importar la modalidad real — pero esto solo afecta cuentas
free en vacantes recientes, no explica que "ninguno" de los filtros funcione
para una cuenta Pro con datos completos.

**Qué hacer cuando se retome:**

1. Reproducir con pasos concretos del usuario: qué filtro, qué valor
   seleccionado, resultado visto vs. esperado (sin eso, no hay repro).
2. Considerar extraer la lógica de `handleFilterChange` a una función pura
   exportada (hoy vive inline en el componente) para poder testearla de
   verdad, y reescribir `validate-dashboard-filters.ts` para importar esa
   función real en vez de reimplementarla.
3. Arreglar el filtro de Modalidad para que no dependa de campos que el
   paywall puede haber nulificado (ej. usar un campo de modalidad estructurado
   si existe, o excluir vacantes bloqueadas del filtro de modalidad).
4. Para poder ver la UI en este entorno en el futuro, instalar las libs que
   pide Playwright (`libnspr4`, `libnss3`, etc.) con sudo interactivo del
   usuario, o usar un entorno con navegador disponible.

**Debe estar resuelto antes de:** confiar en los filtros del Dashboard como
funcionalidad "verificada" — hoy la única señal automatizada
(`test:dashboard-filters`) es falsa confianza.

## Otros pendientes menores (no bloquean nada, quedan para cuando haya espacio)

- **Avatar de usuario**: Fase 3 del flujo de auth dejó el nombre editable
  pero no implementó avatar (`user_metadata` de Supabase ya lo soportaría
  sin cambios de esquema).
- **Bundle principal de Vite > 500kB** tras minificar — `vite build` avisa
  en cada build. No rompe nada, pero vale la pena revisar code-splitting
  adicional (dynamic `import()`) si el tiempo de carga inicial se vuelve un
  problema real.
- **Cancelación de suscripción real**: hoy es pago único de 30 días sin
  auto-renovación, así que no hay nada que "cancelar" — pero si el modelo
  cambia a cobro recurrente automático de Wompi en el futuro, ahí sí habría
  que construir un flujo de cancelación real (hoy Account.tsx solo pide
  escribir a soporte).
