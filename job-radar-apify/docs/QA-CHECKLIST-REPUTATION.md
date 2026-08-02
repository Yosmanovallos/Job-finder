# Checklist manual de QA — Reputación de empleador

Todo lo que `npm run test:reputation` no puede cubrir porque requiere
revisión visual o datos reales de una fuente ya construida. Repetir la
lista completa relevante después de cualquier cambio en
`src/db/company-reputation-repository.ts`,
`src/sources/reputation/*`, `src/engine/resilient-fetch.ts`, o
`scripts/run-reputation-tick.ts`.

**Antes que nada: correr `npm run test:reputation`.** Escribe únicamente
en `company_reputation`/`source_circuit_state`, siempre con identificadores
de prueba (`__test-...__`) y los limpia en un `finally` — nunca toca
`jobs`. Seguro de correr en cualquier momento, mismo estándar de seguridad
que ya usa `docs/QA-CHECKLIST-SEO.md` (este proyecto no tiene base de datos
de test separada).

## 1. Fase R1 — esqueleto (sin fetchers reales todavía)

- [ ] `npx tsx scripts/migrate.ts` corre sin error (idempotente — crea
      `company_reputation` si no existe, no toca ninguna tabla existente).
- [ ] `npm run test:reputation` en verde.
- [ ] `npm run reputation:tick` (o `npx tsx scripts/run-reputation-tick.ts`)
      corre localmente y termina con `📊 0 fuente(s) registrada(s)` /
      `✅ Total upserted: 0` — confirma que el script real (no solo el de
      prueba) también corre limpio.
- [ ] Regresión — correr en este orden y confirmar que ninguno se rompió:
      `npm run build`, `npm run test:seo`, `npm run test:dashboard-filters`.
      (`npm run test:adapters` puede fallar por bloqueos 403 reales de
      fuentes externas como Indeed — eso es un problema de la fuente
      externa, no de este cambio; confirmar con el diff que
      `resilient-fetch.ts` solo cambió de tipos, no de lógica, si aparece
      una falla ahí.)
- [ ] `.github/workflows/reputation-tick.yml` — sintaxis válida (revisar en
      GitHub, pestaña Actions, tras el push; no hace falta ejecutarlo a
      mano todavía, no hay nada que drenar con 0 fuentes registradas).

## 2. Fase R2 — Merco Talento (primer fetcher real)

Repetir tras cualquier cambio en `src/sources/reputation/merco.ts`,
`company-reputation-repository.ts`, `scripts/seed-merco-aliases.ts`,
`ReputationBadges.tsx`, o los 3 puntos de `server.ts` que adjuntan
`reputation` (`GET /api/jobs`, `GET /api/jobs/:id`, `/dashboard` SSR).

- [ ] `npx tsx scripts/migrate.ts` — crea `company_reputation_alias` sin
      tocar nada existente.
- [ ] `npm run test:reputation` en verde (incluye el parser contra el
      fixture real de 200 filas y el fixture de fallback).
- [ ] `npx tsx scripts/seed-merco-aliases.ts` — inserta/actualiza los
      alias curados (87 filas al momento de escribir esto).
- [ ] `npm run reputation:tick` — reporta `1 fuente(s) registrada(s)` y
      ~200 filas actualizadas en `company_reputation` (dato real, en vivo
      contra merco.info).
- [ ] Con el servidor local corriendo: una vacante real de una empresa con
      alias confirmado (ej. Bancolombia, Rappi, Nestlé, Google, Amazon,
      IBM, Accenture, Falabella, Netflix) muestra "Reputación como
      empleador" con "Merco Talento: `<score>` (merco-talento-index)" y un
      link "Ver fuente" — **nunca un logo**. El link resuelve 200 y va a
      `merco.info`, no a la home de BuscoTrabajo.
- [ ] Una vacante de una empresa SIN alias confirmado no muestra la
      sección en absoluto — ni una caja vacía, ni "unknown" visible.
      Verificado visualmente (captura de pantalla), no solo por API.
- [ ] Regresión visual: `/dashboard` (lista + panel de detalle,
      `sticky`, filtros) y una página de vacante individual sin
      reputación se ven exactamente igual que antes — cero cambio visual
      fuera de la sección nueva. Confirmado con `run-job-radar-apify`
      (0 errores de consola en ambas rutas).
- [ ] `npm run test:seo` y `npm run test:dashboard-filters` en verde
      (regresión de fases anteriores).

## 3. Fase R3 — Great Place to Work Colombia (segunda fuente)

Repetir tras cualquier cambio en `src/sources/reputation/gptw.ts`,
`src/sources/reputation/html-entities.ts`, o `scripts/seed-gptw-aliases.ts`.

- [ ] `npm run test:reputation` en verde (incluye el filtro de vigencia de
      395 días contra el fixture real de 154 certificaciones vigentes +
      5 viejas de 2021, y el caso de una empresa con alias de 2 fuentes a
      la vez).
- [ ] `npx tsx scripts/seed-gptw-aliases.ts` — inserta/actualiza los alias
      curados (35 filas al momento de escribir esto).
- [ ] `npm run reputation:tick` — reporta **2 fuente(s) registrada(s)**
      (Merco + GPTW), ~200 filas de Merco sin cambios + ~154 filas nuevas
      de GPTW (el número exacto de GPTW varía con el tiempo — son
      certificaciones que vencen a los 12 meses).
- [ ] Con el servidor local corriendo: una vacante real de una empresa con
      alias de **ambas** fuentes (ej. Accenture, Deloitte, Compensar)
      muestra **dos** entradas en "Reputación como empleador" — Merco con
      score real y "Great Place to Work — certificación", cada una con su
      propio link "Ver fuente" (GPTW usa una URL por empresa, no
      compartida como Merco) — **nunca un logo**.
- [ ] Una certificación GPTW de hace más de ~13 meses nunca aparece como
      vigente (verificar contra la fecha real de una empresa vieja si hay
      forma de confirmarla, o confiar en el test automatizado que ya cubre
      esto con datos reales de 2021).
- [ ] Regresión visual (captura de pantalla real,
      `run-job-radar-apify`, 0 errores de consola): la vacante con las 2
      fuentes se ve limpia, sin romper el layout existente.
- [ ] `npm run test:seo` y `npm run test:dashboard-filters` en verde.

## 4. Página de empresa (`/empresas/:slug`, navegación desde dashboard)

Extensión posterior a las fases R0-R5 (no una de ellas) — reusa el pipeline
de reputación para que, desde el dashboard, el nombre de la empresa en una
vacante lleve a una página propia con su reputación y sus vacantes activas.
Repetir tras cualquier cambio en `resolveCompanyBySlug()`
(`company-reputation-repository.ts`), `buildCompanyPath()`/`buildCompanyUrl()`
(`job-seo.ts`), la ruta `GET /api/companies/:slug` en `server.ts`,
`CompanyLanding.tsx`, o el filtro `company` de `applyJobFilters()`.

- [ ] `npm run test:reputation` en verde (incluye `resolveCompanyBySlug()`
      contra datos reales curados y `GET /api/companies/:slug` contra un
      servidor de prueba propio, sin red externa).
- [ ] Con el servidor local corriendo: abrir una vacante real de una
      empresa **con** reputación (ej. Accenture, Bancolombia) — el nombre
      de la empresa aparece como link. Clic → llega a
      `/empresas/<slug>` mostrando el nombre real, su reputación completa
      (ambas fuentes si tiene las dos) y sus vacantes activas
      (reutilizando `CategoryJobRow`, mismo componente que las páginas de
      categoría de SEO).
- [ ] Abrir una vacante de una empresa **sin** reputación curada (la
      mayoría, ej. una empresa cualquiera fuera de Merco/GPTW) — el
      nombre **también** debe ser un link (todo `job.company` truthy lo
      es). Clic → llega a `/empresas/<slug>` mostrando el nombre real y
      sus vacantes activas reales, **sin** sección de reputación (nunca
      inventada). **Corrección real hecha en esta sesión**: la primera
      versión solo enlazaba cuando había reputación, dejando sin link (y
      sin forma de ver sus propias vacantes agrupadas) a la inmensa
      mayoría de empresas — reportado por el usuario en vivo con "BAE
      Systems USA". Corregido con `resolveCompanyNameFromJobs()` como
      fallback en `GET /api/companies/:slug`: si el slug no está en la
      tabla de alias, se resuelve igual contra cualquier empresa real del
      corpus de vacantes — solo un slug que no matchea absolutamente nada
      es un 404 real.
- [ ] `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/companies/<slug-inventado-que-no-existe-en-nada>`
      → 404 real.
- [ ] Regresión visual (captura de pantalla real, `run-job-radar-apify`,
      0 errores de consola): `JobCard`/`JobDetailPanel` se ven igual que
      antes para vacantes sin reputación; el layout de `/dashboard` no
      cambió.
- [ ] `npm run test:seo` y `npm run test:dashboard-filters` en verde.

## 5. Fase R4 (retomada) — Computrabajo (descubrimiento vía `jobs` propia)

Repetir tras cualquier cambio en `src/sources/reputation/computrabajo.ts`,
`getComputrabajoDiscoveryCandidates()` (`company-reputation-repository.ts`),
o `.github/workflows/reputation-tick.yml`. A diferencia de Merco/GPTW, acá
no hay script de seed manual — el propio `computrabajoAdapter.fetch()`
descubre y escribe sus alias en la misma corrida (ver
`docs/COMPANY-REPUTATION-PLAN.md` §R4 para el porqué).

- [ ] `npm run test:reputation` en verde (incluye
      `unwrapGoogleRedirect()`, `extractCompanySlugFromJobPageHtml()`
      contra el fixture real `tests/fixtures/computrabajo-job-page-sample.html`
      — el link real `offer-grid-article-company-url`, nunca el widget
      condicional "Mostrar los N salarios" — y `parseComputrabajoEvaluationsPage()`
      contra `tests/fixtures/computrabajo-evaluaciones-sample.html` — score
      con coma decimal española, conteo real de reseñas, y el caso de URL
      final redirigida silenciosamente a la home).
- [ ] `npm run reputation:tick` — reporta **3 fuente(s) registrada(s)**
      (Merco + GPTW + Computrabajo). Corridas reales de esta sesión: 7 de
      hasta 15 candidatos resueltos en la primera (`ACTIVOS S A S`,
      `Adecco Colombia S.A.`, `AGENCIA DE EMPLEO COMFAMA`, `Eficacia`,
      `Manpower Group Colombia`, `SERDAN - MISION TEMPORAL`, `SOLVO
      S.A.S`), sin disparar el circuit breaker (0 fallos consecutivos). Si
      la corrida devuelve consistentemente 0 empresas nuevas en corridas
      sucesivas mientras `getComputrabajoDiscoveryCandidates()` sigue
      teniendo candidatos pendientes, es la señal de que el extractor de
      slug volvió a quedar atascado en el mismo problema que ya se corrigió
      una vez esta sesión (ver §5.4 del plan) — no asumir que esas
      empresas "simplemente no tienen datos" sin antes probar
      `extractCompanySlugFromJobPageHtml()` a mano contra la página de
      vacante real de una de ellas.
- [ ] Con el servidor local corriendo: `/empresas/<slug-de-una-empresa-recién-descubierta>`
      (ej. `/empresas/eficacia`) muestra "Reputación como empleador" con
      "computrabajo: `<score>` (1-5) · `<N>` reseñas" y un link "Ver
      fuente" — **nunca un logo**. Verificado en vivo esta sesión con
      Eficacia: `4.6 (1-5) · 21088 reseñas`, coincide exactamente con la
      fila real en `company_reputation`.
- [ ] Confirmar que `source_circuit_state` no tiene a "Computrabajo"
      marcado como degradado tras una corrida normal (`SELECT * FROM
      source_circuit_state WHERE source_name ILIKE '%computrabajo%'` →
      vacío). Si aparece degradado, es la señal esperada de que el sitio
      empezó a bloquear en esa corrida — no reintentar manualmente, dejar
      que el circuit breaker se recupere solo (30 min) y la próxima
      corrida mensual siga desde ahí.
- [ ] `.github/workflows/reputation-tick.yml` — cron cambiado a mensual
      (`0 6 1 * *`); confirmar sintaxis válida en la pestaña Actions tras
      el push.
- [ ] Regresión: `npm run build`, `npm run test:seo`,
      `npm run test:dashboard-filters` en verde.

## Nota de seguridad

Este proyecto **no tiene una base de datos de test separada** — el mismo
`DATABASE_URL` de `.env` es el de producción. `npm run test:reputation` es
seguro de correr en cualquier momento: solo escribe filas con
identificadores de prueba claramente marcados (`__test-...__`,
`__TEST COMPANY ...__`) en `company_reputation`/`source_circuit_state`, y
las borra siempre en un `finally`, sin excepción. Nunca llama a
`saveJobs()`/`clearRepository()` ni toca la tabla `jobs`.
