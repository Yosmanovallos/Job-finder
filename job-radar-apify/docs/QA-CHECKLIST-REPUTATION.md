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

## 2. Fase R2 en adelante (Merco, GPTW, Computrabajo) — placeholder

Se completa cuando exista el primer fetcher real. Como mínimo debe cubrir:

- [ ] Un dato real de la fuente aparece en `company_reputation` tras correr
      `npm run reputation:tick` localmente.
- [ ] La página de una vacante real de una empresa con alias confirmado
      muestra la sección "Reputación" con atribución en texto + link —
      nunca un logo de la fuente.
- [ ] Una vacante de una empresa SIN alias confirmado no muestra la
      sección en absoluto (ni un placeholder, ni "unknown" visible).
- [ ] El link de atribución de cada fuente resuelve 200 y lleva a la
      página real de esa fuente (no a la home de BuscoTrabajo).
- [ ] `score_scale` distinto por fuente es visible/legible — nunca dos
      scores de fuentes distintas se muestran como si fueran comparables
      entre sí.

## Nota de seguridad

Este proyecto **no tiene una base de datos de test separada** — el mismo
`DATABASE_URL` de `.env` es el de producción. `npm run test:reputation` es
seguro de correr en cualquier momento: solo escribe filas con
identificadores de prueba claramente marcados (`__test-...__`,
`__TEST COMPANY ...__`) en `company_reputation`/`source_circuit_state`, y
las borra siempre en un `finally`, sin excepción. Nunca llama a
`saveJobs()`/`clearRepository()` ni toca la tabla `jobs`.
