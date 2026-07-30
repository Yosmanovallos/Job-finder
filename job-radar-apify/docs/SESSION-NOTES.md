# Notas de sesión — rediseño del dashboard + SEO (Fases 0-2)

Resumen de decisiones, causas raíz y datos que costó trabajo averiguar en
esta sesión, para no tener que volver a investigarlos ni repetir intentos
que ya se descartaron. No es un plan (para eso está `SEO-PLAN.md`) — es la
memoria de "por qué está así" y "eso ya lo intentamos, no funciona".

## 1. Rediseño del dashboard (UI/UX)

**Qué cambió**: filtros pasaron de columna lateral fija a una barra
superior (fecha/modalidad/ciudad inline + botón "Filtros" para el resto) —
en desktop abre un dropdown anclado al botón, en mobile una hoja de
pantalla completa. El layout quedó en dos columnas (lista + detalle) en
vez de tres (filtros + lista + detalle).

**Causa raíz de los bugs de `sticky` rotos** (dos bugs distintos, mismo
síntoma — la barra de búsqueda y el panel de detalle dejaban de quedarse
pegados al hacer scroll):

1. `App.tsx` envolvía toda la app en un `<div overflow-x-hidden>`. Fijar
   `overflow-x` sin fijar `overflow-y` fuerza al navegador a promover
   `overflow-y` de `visible` a `auto` (quirk real del spec de CSS) — ese
   div se convertía en el contenedor de scroll real de la página en vez
   del `viewport`, y `position: sticky` se computa contra el ancestro con
   overflow no-visible más cercano. **Arreglo**: se quitó de `App.tsx` y
   se movió a `html { overflow-x: hidden }` en `index.css` — el overflow
   en la raíz se propaga al viewport mismo, sin crear un contenedor
   anidado.
2. El mismo bug, disparado por otra vía: `document.body.style.overflow =
   "hidden"` (para bloquear el scroll de fondo mientras el dropdown de
   filtros de escritorio estaba abierto) volvía a romper el sticky
   apenas se abría. Ese bloqueo ahora solo aplica en mobile (donde sí
   hace falta, porque la hoja cubre toda la pantalla); el dropdown de
   escritorio no bloquea el scroll de fondo.

**Otros bugs encontrados y arreglados**:
- Mobile y desktop montaban los dos árboles de componentes a la vez (uno
  oculto con CSS) — se duplicaba el trabajo de React en cada scroll
  infinito. Arreglado con un `isDesktop` (via `matchMedia`) que renderiza
  solo uno de los dos.
- El panel de detalle (`sticky top-40`) no tenía suficiente separación de
  la barra de búsqueda (`sticky top-16`) — al hacer scroll, la barra
  opaca tapaba la franja de color del panel. Aumentado el offset.

## 2. SEO — Fases 0, 1 y 2 (ver `SEO-PLAN.md` para el detalle completo)

Root cause del problema original ("10,000 vacantes, cero en Google"): la
app es un SPA sin SSR — Googlebot indexó `/dashboard` con **"0 de 0
vacantes"** porque el `fetch()` a `/api/jobs` no terminaba a tiempo dentro
del presupuesto de renderizado del rastreador. Confirmado con evidencia
real de Search Console, no solo teoría.

**Arquitectura elegida**: `/empleos/:id/:slug` — el `:id` (jobId, UUID) es
lo único que se usa para el match; el `:slug` es cosmético, generado al
vuelo. **No hizo falta ninguna migración de base de datos** — no existe
columna `slug`. El HTML de esas páginas y de `/dashboard` se genera en
`server.ts` reusando `getJobsCached()` (el mismo caché que ya usa
`/api/jobs`, cero queries nuevas).

**Hecho**: Fase 0 (auditoría), Fase 1 (páginas individuales + SSR de
`/dashboard` + `window.__SSR_JOBS__` para que el cliente no re-pida lo que
ya recibió), Fase 2 (sitemap dinámico como índice: `sitemap.xml` →
`sitemap-pages.xml` + `sitemap-jobs.xml`, 10,170 vacantes reales).

**Pendiente**: Fase 3 (Indexing API), Fase 4 (páginas de categoría), Fase
5 (manejo de vencimiento/410).

## 3. Cosas que ya se intentaron y NO funcionan / no repetir

- **No hay base de datos de test separada.** `DATABASE_URL` de `.env` es
  la misma de producción. `test:paywall` y `test:payment-flow` SÍ borran
  datos reales (`clearRepository()`) — están bloqueados detrás de
  `ALLOW_TEST_DB_WIPE=true` a propósito. `test:seo` es de solo lectura,
  seguro de correr siempre.
- **No intentar loguear al usuario en Google (u otro servicio) vía
  Playwright/automatización**, ni aunque el usuario ofrezca la
  contraseña. Google detecta y bloquea navegadores controlados por
  automatización (el flag de CDP/`navigator.webdriver`) independientemente
  de si quien escribe es un humano o un script — no es algo que se pueda
  evadir de forma legítima. Además, en este entorno WSL las ventanas de
  Chromium lanzadas con `headless: false` no son confiablemente
  interactivas para el usuario (aparecen en la barra de tareas de Windows
  vía WSLg pero no siempre renderizan al hacer clic) — confirmado
  empíricamente, no vale la pena reintentarlo como mecanismo de control
  compartido.
- **La propiedad de Search Console de `buscotrabajo.co` ya estaba
  verificada desde antes de esta sesión** (dominio, autenticada vía
  GoDaddy en su momento) — no hace falta re-verificarla. El sitemap viejo
  (sin vacantes) ya estaba enviado; lo único pendiente es reenviar la
  nueva versión (`sitemap.xml` ahora es un índice).
- **El servidor corre en el plan Starter de Render ($7/mes), no el
  gratuito** — no hay cold-start que explique lentitud. Si algo se ve
  lento, no es por eso.

## 4. Datos que no son obvios leyendo el código

- `PAYWALL_ENABLED = false` hoy (`config.ts`) — el enmascarado de campos
  para vacantes <48h está desactivado, pero todo el código de SEO
  (`isPubliclyDescribable`, `maskLockedFields`) ya está escrito para
  respetarlo automáticamente si se reactiva, sin tocar nada de nuevo.
- `verifySession()` solo lee el header `Authorization` — una navegación
  de página normal (`<a href>`, escribir la URL) nunca lo envía. Por eso
  cualquier HTML generado en el servidor para una ruta de página (no
  `/api/*`) siempre resuelve como tier "free", sin importar quién esté
  realmente visitando.
- `getJobs()`/`getJobsCached()` hace `DISTINCT ON (title, company,
  location)` — cualquier cosa que liste vacantes (sitemap, SSR) debe
  construirse contra esa función, nunca contra una query nueva a la tabla
  `jobs` cruda, o se listan ids que las páginas individuales no
  encuentran.

## 5. Dónde está todo

| Qué | Dónde |
|---|---|
| Plan completo de SEO + resultado de cada fase | `docs/SEO-PLAN.md` |
| Checklist manual de QA para SEO | `docs/QA-CHECKLIST-SEO.md` |
| Checklist manual de QA para auth/pagos (preexistente) | `docs/QA-CHECKLIST-AUTH.md` |
| Test automatizado de SEO (solo lectura) | `tests/validate-seo-job-pages.ts` → `npm run test:seo` |
| Funciones puras compartidas server+cliente para SEO | `src/lib/job-seo.ts` |
| Página cliente de una vacante individual | `src/sections/JobLanding.tsx` |
