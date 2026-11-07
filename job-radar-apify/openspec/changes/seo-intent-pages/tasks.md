# Tareas — seo-intent-pages

Una sesión por bloque si hace falta. Las pruebas que fallan van antes del
código. Usa un reloj fijo en todas las pruebas nuevas.

## 0. Decisión y contrato

- [x] Leer `docs/SEO-IMPROVEMENT-PLAN.md`, `docs/SEO-PLAN.md` §9-10,
      `docs/QA-CHECKLIST-SEO.md` y `docs/DASHBOARD-PERFORMANCE-RUNBOOK.md`.
- [x] Escribir `docs/adr/0012-intent-categories.md`: tipo `intencion`, país
      por prefijo, «Remoto» sale de la resolución como ciudad, nuevo
      canonical de `/ve/empleos/remoto` y si la API pública gana el filtro.
- [x] Revisión del agente `architect` sobre el ADR y el design. Registrar
      las conclusiones aquí.
  - **Revisión del 2026-11-07:** aprobar con cambios. Todos se aplicaron en
    el ADR 0012:
    - `isRemoteBucket` cubre la intención remoto, con una prueba de hash de
      la copia de `/empleos/remoto`;
    - caché propia `intentPageCache` de 8 entradas, fuera del LRU de 64 del
      dashboard;
    - respaldo del cliente `/api/intent-page` con lista blanca, sin abrir
      `/api/jobs`;
    - columna derivada según el EXPLAIN del Bloque 1;
    - portada sin cambios (SIP-050 frente a D2: gana SIP-050 hasta el
      2026-11-26);
    - nota sobre Cloudflare en el rollback.

## 1. Conteo previo (solo lectura, antes de escribir código)

- [ ] Consulta de solo lectura, acotada y con statement timeout. Para CO y
      VE, contar las vacantes aptas y activas que pasan el clasificador
      «sin experiencia» de D3, nacional y en Bogotá, Medellín y Cali.
      Contar también las de remoto por país.
- [ ] Registrar los conteos en `validation.md`. Si «sin experiencia» en
      Bogotá queda por debajo de 10, sacarla del alcance y anotarlo. La
      guarda sigue igual.

## 2. Clasificador

- [ ] Pruebas rojas de SIP-010 y SIP-011 con un fixture compartido.
- [ ] `classifyExperience(job)`, puro y compartido, y su predicado SQL.
      Decidir si hace falta una columna derivada; si se añade, es una
      migración aditiva que necesita aprobación.

## 3. Resolución y rutas

- [ ] Pruebas rojas de SIP-001 a SIP-004.
- [ ] Añadir `intencion` a `ResolvedCategory`, cambiar el orden de
      resolución, añadir el segundo segmento ciudad × intención (lista
      blanca) y `buildCategoryPath` para las intenciones.
- [ ] La bandera `INTENT_PAGES_ENABLED` y su rollback (design).

## 4. Guarda, sitemap y enlaces

- [ ] Pruebas rojas de SIP-020 a SIP-022.
- [ ] Robots, `sitemap-categories.xml` y enlaces desde el home y los hubs,
      solo si la página es indexable.

## 5. Contenido y hreflang

- [ ] Pruebas rojas de SIP-030 a SIP-033 y SIP-040/041.
- [ ] Title, H1, meta y bloque de respuesta en el SSR y en
      `CategoryLanding`, sin diferencias entre servidor y cliente
      (hidratación).

## 6. Rendimiento y no regresión

- [ ] Benchmark de SIP-052 con 3.000 filas: ms por petición y RSS tras 500
      peticiones. Registrarlo en `validation.md`.
- [ ] `tsc`, build, `test:unit`, `test:seo`, `test:dashboard-filters` y
      `test:companies-search`.
- [ ] `/seo drift compare` en la portada, `/empleos/bogota`,
      `/empleos/remoto`, una vacante y `/ve/empleos/project-manager`
      (SIP-050).
- [ ] TTFB MISS en frío con URL única, frente al runbook (SIP-051).

## 7. Publicación (cada paso con aprobación)

- [ ] PR con el resumen de pruebas, el benchmark y el drift. Merge solo con
      aprobación.
- [ ] Tras desplegar:
  - repetir el drift y el TTFB;
  - revisar la memoria en Render;
  - inspeccionar las URL nuevas en GSC y en Bing;
  - enviar las URL nuevas por IndexNow (envío diario o manual aprobado).
- [ ] Checkpoints en GSC a +14 y +28 días: impresiones, posición y aparición
      orgánica frente a Google Empleos. Decidir la segunda ola: Medellín y
      Cali sin experiencia, fines de semana, medio tiempo y por días.
- [ ] Archivar el cambio en `changes/archive/`.
