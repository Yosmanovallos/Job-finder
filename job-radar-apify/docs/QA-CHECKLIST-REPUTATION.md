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

## Nota de seguridad

Este proyecto **no tiene una base de datos de test separada** — el mismo
`DATABASE_URL` de `.env` es el de producción. `npm run test:reputation` es
seguro de correr en cualquier momento: solo escribe filas con
identificadores de prueba claramente marcados (`__test-...__`,
`__TEST COMPANY ...__`) en `company_reputation`/`source_circuit_state`, y
las borra siempre en un `finally`, sin excepción. Nunca llama a
`saveJobs()`/`clearRepository()` ni toca la tabla `jobs`.
