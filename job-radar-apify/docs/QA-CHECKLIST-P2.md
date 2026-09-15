# QA — P2 Observabilidad de ejecuciones (`74bbe7a`, `7aa6738`, `f0b9e21`)

Checklist para validar y publicar la fase P2. Nada de esto está aplicado
todavía: la rama `codex/prod-improvements-seo-ux-security` es local y
producción sigue exactamente como estaba.

## Qué toca y qué NO toca esta fase

| Cosa | ¿La toca? |
|---|---|
| Tabla `jobs` (todas las vacantes) | **No.** P2 no la lee para escribir ni la modifica. |
| `users`, `transactions`, `cv_*`, `company_reputation`, `indexing_queue` | **No.** |
| Tablas nuevas `scrape_runs` / `source_attempts` | Sí — se crean vacías. |
| Borrados | Solo filas de `scrape_runs` con más de 30 días (y sus intentos en cascada). Nunca vacantes. |
| Datos personales | Ninguno: no se guardan usuarios, correos, ni contenido de vacantes. |
| Mensajes de error crudos | No se guardan (pueden traer URLs con credenciales); solo la clase del error. |

## 1. Antes de tocar producción (local, sin riesgo)

Requiere Docker Desktop abierto. Usa una base temporal, nunca la real.

- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run build`

## 2. Crear las tablas en la base real

La migración aplica `schema.sql` completo, como en fases anteriores: todo
es `CREATE TABLE/INDEX IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`, sin
`DROP TABLE`, `TRUNCATE` ni `DELETE`.

- [x] `npx tsx scripts/migrate.ts` — **hecho 2026-09-15**.
- [x] Repetirlo una segunda vez: terminó igual de bien (idempotente).
- [x] `npx tsx scripts/verify-p2-observability.ts` → tablas creadas, RLS
      activo, 0 permisos para `anon`/`authenticated`, ambas vacías (32 kB),
      corpus intacto.

> Nota: el `.env` vive en la carpeta principal, no en el worktree. Para
> ejecutar los scripts de esta rama contra la base real sin duplicar el
> archivo de credenciales, sitúate en `Job-finder/job-radar-apify` (de ahí
> se cargan las variables) e invoca el script por su ruta completa en
> `Job-finder-prod-improvements/job-radar-apify/scripts/…`.

Si algo falla aquí, **no despliegues** y revisa antes.

## 3. Token del panel de diagnóstico (opcional)

Sin esto, `/api/admin/runs` responde `404` y el resto funciona igual.

- [x] Generar: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
- [x] Guardarlo en el gestor de contraseñas (nunca en git ni en un chat).
- [x] Render → servicio `job-radar-apify` → Environment → `OPS_ADMIN_TOKEN`
      — **hecho 2026-09-15**; comprobado de forma indirecta (404 → 401).
- [x] Añadir la variable a `.env.example`.

## 4. Desplegar

- [x] Fusionar la rama a la que Render tiene conectada y subirla —
      **hecho 2026-09-15**: `main` avanzó de `74f066b` a `5d41861` en
      fast-forward, sin `--force`.
- [x] Esperar el despliegue y comprobar que el sitio carga con normalidad
      — activo ~60 s después del push, `/api/health` en `200`.

Orden recomendado: tablas (paso 2) antes del despliegue. Si se invierte,
no se pierde nada: los ticks siguen guardando vacantes y solo `/api/runs`
responde `503` hasta aplicar la migración.

## 5. Después del despliegue

- [ ] `https://tu-sitio/api/runs` responde `200` con ejecuciones reales.
- [ ] Tras uno o dos ticks (15 min), `npx tsx scripts/verify-p2-observability.ts`
      muestra ejecuciones y el estado real por fuente.
- [ ] El resumen del workflow en GitHub Actions trae la columna **Estado**.
- [ ] Con token: `Invoke-RestMethod "https://tu-sitio/api/admin/runs" -Headers @{Authorization="Bearer $t"}`
- [ ] Sin token o con uno incorrecto: responde `401`.
- [ ] Velocidad: `npx tsx scripts/verify-p2-observability.ts --url https://tu-sitio.com`
      → p95 por debajo de 800 ms.

## 6. Una semana después

- [ ] `npx tsx scripts/verify-p2-observability.ts` → tamaño de
      `source_attempts` por debajo de ~15 MB. Si lo supera, bajar la
      retención de 30 a 14 días (`RUN_RETENTION_DAYS` en
      `src/observability/run-telemetry.ts`).

## Marcha atrás

- **Revertir el código:** `git revert` de los tres commits. Las tablas
  quedan sin usarse; no se pierde ninguna vacante.
- **Quitar las tablas** (solo si quieres limpiar de verdad; borra el
  historial de ejecuciones, nada más):
  `DROP TABLE source_attempts; DROP TABLE scrape_runs;`
- **Apagar solo el panel admin:** borrar `OPS_ADMIN_TOKEN` en Render.
