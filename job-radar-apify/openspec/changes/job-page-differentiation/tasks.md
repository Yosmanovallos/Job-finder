# Tareas

Fase de diseño (esta entrega):

- [x] Leer `CLAUDE.md`, `SEO-IMPROVEMENT-PLAN.md`, el contrato JobPosting,
  el runbook del dashboard y las auditorías del 28/29-Oct.
- [x] Inventario de datos por vacante y empresa en el código
  (`getJobById`, `buildJobPageBody`, `JobDetailPanel`, cachés).
- [x] Muestra de 200 páginas en producción (lectura pública, concurrencia 2):
  `docs/seo-evidence/job-page-diff-2026-10-30.json`.
- [x] Propuesta, diseño y requisitos JPD-001…010.
- [ ] Revisión del usuario; push y PR solo con su aprobación.

Implementación (otra sesión, solo si se aprueba):

1. Pruebas que fallan primero
   - [ ] JPD-001: hash de descripción y JobPosting sobre fixtures.
   - [ ] JPD-008: contador de `pool.query` por respuesta, anónimo y con sesión.
   - [ ] JPD-002/003/009: render SSR de B1 con empresa real, placeholder,
     empresa de una sola vacante y nombre con variantes.
   - [ ] JPD-007: paridad SSR ↔ `JobLanding` con la misma carga.
2. Medición previa
   - [ ] `EXPLAIN ANALYZE` en lectura de la consulta del índice por país
     (opción B) y tamaño en memoria; aplicar la puerta de `design.md` §2.
   - [ ] Línea base de TTFB MISS en frío para 5 vacantes (runbook).
3. Implementación
   - [ ] Caché propia de empresa (B o A) con `peek`, fuera de
     `companyPageCache` y del LRU del dashboard; sin warmup de arranque.
   - [ ] B1 en `__SSR_JOB_LINKS__`, SSR y `JobLanding`.
   - [ ] B2: mover `attachReputation` antes del body en la rama anónima;
     helper compartido con `/empresas/:slug`.
   - [ ] B3: hechos de portal oficial y enlace curado.
4. Validación
   - [ ] `npx tsc --noEmit`, `npm run build`, `test:unit`, `test:seo`,
     `test:integration`; `/seo drift compare` de las URLs de baseline.
   - [ ] Capturas a 390 y 1440 px sin scroll horizontal.
   - [ ] TTFB MISS después; registrar en el runbook.
5. Después del despliegue
   - [ ] Repetir la muestra (§6.2) y registrar la proporción.
   - [ ] Checkpoints GSC 2026-11-12 y 2026-11-26 (§6.3), sin atribuir.
   - [ ] Decisión del 26-Nov (§6.4). Archivar el cambio.

Aparte (no en este cambio):

- [ ] Medición de solo lectura de grupos de identidad con más de una fuente
  («También publicada en», `design.md` §5).
- [ ] Meta description «Vacante agregada de…» en `buildJobMeta()`
  (contrato §5, fase I sin terminar).
