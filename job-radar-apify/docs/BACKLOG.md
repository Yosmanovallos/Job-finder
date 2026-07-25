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

## Separar el scraper del proceso web (CRÍTICO — mitigado con un stopgap)

**Qué:** `src/queue/cron.ts` + `src/queue/scheduler.ts` corren el scraping
(hasta 12 roles cada 5 min, 3 en paralelo) dentro del mismo proceso Node que
sirve el sitio web y el login. El 2026-07-25, en producción (Render free
tier), esto causó `FATAL ERROR: Reached heap limit — JavaScript heap out of
memory` (exit code 134 / SIGABRT) de forma recurrente — cada vez que el
proceso moría, se caía TODO: login, dashboard, checkout, todo, no solo el
scraper.

**Stopgap ya aplicado (no es la solución):** el usuario apagó `ENABLE_CRON`
en Render → Environment. Esto detiene el scraping automático en background y
mantiene el sitio estable, pero también detiene la actualización del corpus
de vacantes. El botón manual de "Ejecutar escaneo" del dashboard (si se usa)
comparte el mismo riesgo — corre en el mismo proceso.

**Por qué importa:** es la arquitectura correcta que ya estaba prevista en la
visión de producto (ver `product-vision-scaling` en memoria): "queue con
concurrencia controlada... los usuarios leen del store, nunca disparan
scrapes en vivo". Retomar esto también es requisito para escalar a los 200+
roles de la visión — con 30 roles ya tumbó el proceso; con 200 sería peor.

**Qué hacer cuando se retome:** mover `globalScheduler`/`startCronScheduler`
a un servicio de Render separado (Background Worker o Cron Job), con su
propio proceso y memoria, que escriba a la misma Postgres/Supabase pero no
comparta heap con el servicio web. El servicio web deja de importar
`queue/cron.ts` por completo.

**Debe estar resuelto antes de:** reactivar `ENABLE_CRON=true`, y antes de
intentar escalar más allá de los ~30 roles actuales (`DEFAULT_ROLES_200` en
`scheduler.ts`, que hoy solo tiene 30).

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
