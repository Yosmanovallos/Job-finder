# Backlog — Expansión a Venezuela (y escalado multi-país)

Plan de implementación derivado de la investigación de viabilidad del
2026-08-02 (6 agentes de investigación en paralelo + verificación directa de
frescura). Reporte completo con evidencia por fuente:
https://claude.ai/code/artifact/9ed3b4a9-2b34-492c-ad0f-f44d6daecd44

Decisión de arquitectura ya tomada: **una sola app, una sola base de datos,
país como dimensión de datos** — no apps ni bases de datos separadas por
país. Rompería el comportamiento ya existente de remoto=`NULL` compartido
entre países, la reputación de empresas que cruzan fronteras, y las
suscripciones. Lo único legítimamente separado por país es la URL de cara al
usuario (ver Día 3+).

## Día 1 (mañana) — plumbing + cambios de string, cero adaptadores nuevos

Objetivo: país como config/columna de primera clase, y las fuentes que ya
scrapea el proyecto sirviendo Venezuela con el mismo parser.

- [ ] Columna `country` en la tabla `jobs` + backfill `'CO'` para lo
      existente. `NULL` para remoto (ya es el comportamiento implícito de
      "Remoto" como pseudo-ciudad en `CITY_OPTIONS`, `src/lib/job-filters.ts`).
- [ ] Módulo `countries/<code>.ts`: código ISO, nombre, ciudades, y por
      fuente un flag `countryFromFetch: boolean` que generaliza
      `COLOMBIA_SCOPED_SOURCES` (`src/index.ts:1467-1502`) — ese filtro ya
      implementa la separación de 3 vías (país-conocido-al-fetch /
      resuelto-por-texto-libre / remoto-pasa-siempre) que necesitamos para
      escalar; el trabajo es generalizarlo, no construirlo de cero.
- [ ] LinkedIn (`src/index.ts:223`) → agregar `Venezuela` como valor de
      `location` en la config de país. Verificado: mismo formato de
      respuesta, datos reales geolocalizados (Caracas, Maracaibo, Valencia,
      etc.), mismo `robots.txt Disallow: /jobs-guest/` ya aceptado hoy para
      CO. Flujo débil por keyword (~2/30 en la muestra dentro de la ventana
      de 2 días) pero es el cambio más barato de todos.
- [ ] Computrabajo (`src/index.ts:288-410`) → el dominio real de Venezuela es
      **`ve.computrabajo.com`**, no `www.computrabajo.com.ve`. Ajustar:
      - proxy `translate.goog` a `https://ve-computrabajo-com.translate.goog/...`
        (no el patrón `www-computrabajo-com-ve...`)
      - el `.replace(...)` que limpia el host del proxy
      - `canonicalUrl` reconstruido como `https://ve.computrabajo.com${...}`
      - default de ubicación del fallback a `"Venezuela"`
      - selectores/regex de parseo NO cambian, son idénticos a CO.
      Verificado como la fuente con mejor flujo real: **8 de 20 resultados**
      de una sola keyword cayeron dentro de la ventana de 2 días — el mejor
      dato de frescura medido de todas las fuentes VE.
- [ ] Jooble (`src/index.ts:1041-1045`) → el body del request manda
      `location: "Colombia"` hardcoded; agregar una segunda llamada con
      `location: "Venezuela"` (o iterar países). No se pudo probar en vivo
      por falta de `JOOBLE_API_KEY` en el entorno de investigación.
- [ ] Generalizar el allowlist de `isColombiaOrRemote()` (`src/index.ts:1478`)
      para incluir `venezuela`/`caracas` — un solo cambio que además
      reactiva Workana, RemoteOK y Remotive para VE de una vez (ver nota de
      Workana abajo sobre por qué hoy no importa tanto).
- [ ] Arreglar el fallback del fingerprint de dedupe: `COALESCE(location,
      'colombia')` en `src/sources/types.ts:60` y
      `src/db/job-repository.ts:191,196` debe caer al país de la fila, no al
      string literal `'colombia'` — si no, un job venezolano sin `location`
      colisiona con uno colombiano en el `DISTINCT ON`. Verificar que el
      fallback nuevo hashea igual que el actual para las filas CO existentes
      antes de desplegar, para no disparar un re-fingerprint/re-ingest
      masivo.
- [ ] `country` como parámetro en `GET /api/jobs` y en el filtro del
      dashboard.
- [ ] **Workflow de GitHub Actions separado por país**:
      `.github/workflows/scrape-jobs-ve.yml`, mismo patrón que
      `scrape-jobs.yml` (cron cada 15 min, `MAX_ROLES_PER_RUN=8`,
      `timeout-minutes: 27`, `OVERALL_DEADLINE_MS` de 20 min), corriendo en
      paralelo al de Colombia — **no** agregar Venezuela como más fuentes
      dentro del mismo tick compartido. El presupuesto de 8 roles/tick es
      fijo; compartirlo entre países diluye la frescura de ambos. Como
      workflow separado, GitHub lo trata como job concurrente independiente
      (muy por debajo del límite de 20 jobs concurrentes de la cuenta), y
      sigue costando $0 por ser repo público.
- [ ] Antes de sumar el segundo workflow: poner un `max` explícito y bajo en
      el `Pool` de `src/db/client.ts` (ej. `max: 5`) — hoy usa el default de
      `pg` (10). No es urgente con un solo país, pero es la única línea que
      protege contra saturar conexiones cuando haya 3-4 workflows de país
      corriendo en paralelo. Confirmar también que `DATABASE_URL` usa el
      modo "Session pooler" de Supabase (200 conexiones) y no el directo (60)
      — el propio mensaje de error en `client.ts` ya lo recomienda para
      procesos serverless como un tick de Actions.
- [ ] Chequeo de 2 minutos antes de comprometerse a más países: tamaño
      actual de la base de datos en Supabase (Project Settings → Database →
      Usage) contra el tope de 500 MB del plan free. `purgeOldJobs()` ya
      acota el crecimiento a una ventana de 30 días, pero duplicar países
      duplica el volumen dentro de esa ventana.

**Nota importante que cambia la prioridad de Workana**: `source-cadence.ts`
documenta que **Indeed, Glassdoor y Workana ya devuelven 403 en producción
desde el 2026-07-25** (por eso están en cadencia de 24h/24h/48h, para bajar
volumen de requests mientras se busca alternativa). El arreglo del allowlist
para Workana no sirve de nada operativamente hasta que esa fuente vuelva a
responder — no priorizar tiempo ahí mañana.

**Nota Glassdoor** (no es un pendiente de Venezuela, es un hallazgo sobre
Colombia): dos verificaciones independientes recibieron 403 contra
glassdoor.com, y `docs/source-catalog/glassdoor.md` ya documenta 100% de
bloqueo al 2026-07-25. Es probable que Glassdoor Colombia ya no esté
trayendo nada en producción hoy. Vale revisar los logs de producción de esta
fuente independientemente de este plan.

## Día 2 — adaptadores nuevos (volumen adicional real)

- [ ] **UnMejorEmpleo.com.ve** — 1.449 ofertas confirmadas (stock, no
      medido en flujo diario), HTML + selectores, `robots.txt` permisivo.
      Adaptador desde cero: selectores, parseo de fechas, sin fixtures
      todavía.
- [ ] **Magneto365 VE** — sí tiene sección real (16 ofertas confirmadas vía
      JSON-LD: Farmatodo Venezuela, Caracas/Tucacas/San Felipe/Guarenas),
      pero **no es un simple swap `/co/`→`/ve/`**: el endpoint de búsqueda es
      `/ve/trabajos/buscar`, distinto al `/ve/empleos?q=...` que usaría un
      cambio ingenuo. La URL de detalle sí sigue el mismo patrón
      (`/ve/empleos/<slug>-<id>`). Nota preexistente (no bloqueante, ya
      aplica igual a CO hoy): `robots.txt` de magneto365.com tiene
      `Disallow: /*?` salvo `paginator[page]`.

## Día 3+ — no bloquea el lanzamiento

- [ ] Reputación de empleador para VE: Merco/GPTW/Computrabajo-reputation son
      específicos de Colombia — hacerlo null-safe por país en vez de
      bloquear el lanzamiento (consistente con la regla de "siempre
      navegable" ya adoptada para `/empresas/:slug`).
- [ ] Digests sociales y SEO/cola de indexación con scoping por país.
- [ ] **Decidir la forma de URL ahora, aunque se implemente después**:
      `/ve/...` (path prefix) vs. dominio vs. query param, con canonical
      tags. `job-seo.ts` y la cola de indexación ya emiten URLs colombianas
      hoy — cambiar esto después implica re-crawl.
- [ ] Pagos: Venezuela tiene complicaciones reales de moneda/procesador que
      Colombia no tiene. Es una rama de config dentro del módulo de pagos
      existente, sigue siendo una sola app — no se resuelve en el
      lanzamiento inicial.

## Excluido del alcance — pendiente de decisión explícita del dueño del producto

- **BuscoJobs Venezuela** (8.754 ofertas, 1.778 empresas — el mayor volumen
  encontrado en toda la investigación). Su `robots.txt` bloquea
  explícitamente por nombre al user-agent `ClaudeBot` (junto con otros
  crawlers de IA), aunque permite acceso genérico a las mismas rutas.
  Decidir con qué user-agent presentarse ahí es la misma pregunta que evadir
  ese control con otro nombre — regla 8 de `AGENTS.md` (nunca bypasear
  anti-bot). No es la misma situación que la decisión ya tomada sobre
  Indeed/Glassdoor/Workana (conflictos de ToS genéricos en fuentes que ya
  corren): aquí hay una directiva nombrada específicamente contra crawlers
  de IA en una fuente que hoy no existe en el proyecto. Fuera de cualquier
  plan de implementación hasta que el dueño del producto decida
  explícitamente cómo proceder (ej. contactarlos, buscar un feed oficial).

## Descartado (verificado, no vale la pena investigar de nuevo)

- **Elempleo** — confirmado sin presencia en Venezuela (`/ve/ofertas-empleo`
  → 404, sin subdominio `.ve`, marca 100% Colombia).
- **GetOnBoard/GetOnBrd** — cobertura débil incluso para Colombia (0 CO
  explícito en la muestra), sin evidencia de presencia en Venezuela.
- **Torre.co** — ya pasa por casualidad vía la rama `remote:true` del
  filtro, no por diseño explícito de país. No requiere trabajo hoy, pero es
  frágil si `remote` deja de ser el default.
- **Bumeran Venezuela** — sitemap XML abierto con ~700+/día, pero las
  páginas de empleo son una SPA sin datos embebidos; extraer el detalle real
  requeriría Playwright o su API interna no documentada. Rompe la prioridad
  de "usar siempre el método más liviano". No priorizar sin evaluar el costo
  de Playwright.
- **Jobomas** — señales contradictorias sobre volumen, sin evidencia
  confiable.
- Kontrata (marketplace de servicios, no de empleo), Konzerta (marca de
  Panamá), Multitrabajos (marca de Ecuador), Tecoloco (solo Centroamérica),
  Porton, Trabajando.com, Konexo, Konvocatoria, Analítica Empleos, Espacio
  Empleo, OpcionEmpleo.com.ve (anti-bot fuerte tipo Google, no verificable
  sin evadir controles) — sin presencia real verificada en Venezuela o sin
  forma de confirmarla sin romper reglas del proyecto.
