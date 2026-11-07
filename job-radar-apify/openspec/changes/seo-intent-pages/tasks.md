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

- [x] Consulta de solo lectura, acotada y con statement timeout. Para CO y
      VE, contar las vacantes aptas y activas que pasan el clasificador
      «sin experiencia» de D3, nacional y en Bogotá, Medellín y Cali.
      Contar también las de remoto por país.
- [x] Registrar los conteos en `validation.md`. Si «sin experiencia» en
      Bogotá queda por debajo de 10, sacarla del alcance y anotarlo. La
      guarda sigue igual.
  - **2026-11-07:** Bogotá tiene 47, así que se queda.
  - Medellín (33) y Cali (15) pasarían la guarda; quedan para la segunda ola.
  - VE sin experiencia tiene 11.
  - No se añade columna derivada: el EXPLAIN dio 0 lecturas a disco
    (`validation.md` §2).

## 2. Clasificador

- [x] Pruebas rojas de SIP-010 y SIP-011 con un fixture compartido.
- [x] `classifyExperience(job)`, puro y compartido, y su predicado SQL.
      Decidir si hace falta una columna derivada; si se añade, es una
      migración aditiva que necesita aprobación.

## 3. Resolución y rutas

- [x] Pruebas rojas de SIP-001 a SIP-004.
- [x] Añadir `intencion` a `ResolvedCategory`, cambiar el orden de
      resolución, añadir el segundo segmento ciudad × intención (lista
      blanca) y `buildCategoryPath` para las intenciones.
- [x] La bandera `INTENT_PAGES_ENABLED` y su rollback (design).

## 4. Guarda, sitemap y enlaces

- [x] Pruebas rojas de SIP-020 a SIP-022.
- [x] Robots, `sitemap-categories.xml` y enlaces desde el home y los hubs,
      solo si la página es indexable.

## 5. Contenido y hreflang

- [x] Pruebas rojas de SIP-030 a SIP-033 y SIP-040/041.
- [x] Title, H1, meta y bloque de respuesta en el SSR y en
      `CategoryLanding`, sin diferencias entre servidor y cliente
      (hidratación).

## 6. Rendimiento y no regresión

- [x] Benchmark de SIP-052 con 3.000 filas: ms por petición y RSS tras 500
      peticiones. Registrarlo en `validation.md`.
- [x] `tsc`, build, `test:unit`, `test:seo`, `test:dashboard-filters` y
      `test:companies-search`.
- [x] `/seo drift compare` en la portada, `/empleos/bogota`,
      `/empleos/remoto`, una vacante y `/ve/empleos/project-manager`
      (SIP-050).
- [~] TTFB MISS en frío con URL única, frente al runbook (SIP-051).
  - **Local:** los hubs y el dashboard quedan dentro de ±10 %.
  - **Producción:** el EXPLAIN de las páginas de intención da 0,9–2 s, frente
    a 0,75 s del hub, así que en frío no se cumple. Se mitiga con el sitemap
    y la caché. Se propone una columna derivada. Hay que medirlo tras
    desplegar.

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
- [ ] Después de la lectura del 2026-11-26 de `city-hub-pages`, revisar
      `/empleos/remoto` (CO): decidir si recibe el title y H1 de D4 («Trabajo
      remoto en Colombia: {n} vacantes desde casa») y el bloque de respuesta,
      con su propia medición.
- [ ] Archivar el cambio en `changes/archive/`.
