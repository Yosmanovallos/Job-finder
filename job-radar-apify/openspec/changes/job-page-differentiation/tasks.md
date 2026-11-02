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
   - [x] JPD-001: hash de descripción y JobPosting sobre fixtures.
   - [x] JPD-008: contador de `pool.query` por respuesta, anónimo y con sesión.
   - [x] JPD-002/003/009: render SSR de B1 con empresa real, placeholder,
     empresa de una sola vacante y nombre con variantes.
   - [x] JPD-007: paridad SSR ↔ `JobLanding` con la misma carga.
2. Medición previa
   - [x] ~~`EXPLAIN ANALYZE` de la opción B~~: no se corrió. La sesión
     que encargó la implementación fijó la opción A (caché por empresa con
     `peek`), con 1 carga concurrente porque el pool tiene 5 conexiones.
   - [x] Línea base de TTFB MISS en frío para 5 vacantes (runbook).
3. Implementación
   - [x] Caché propia de empresa (A) con `peek`, fuera de
     `companyPageCache` y del LRU del dashboard; sin warmup de arranque.
   - [x] B1 en `__SSR_JOB_LINKS__`, SSR y `JobLanding`.
   - [x] B2: mover `attachReputation` antes del body en la rama anónima;
     helper compartido con `/empresas/:slug`.
   - [x] B3: hechos de portal oficial y enlace curado.
4. Validación
   - [x] `npx tsc --noEmit`, `npm run build`, `test:unit`, `test:seo`,
     `test:integration`. `/seo drift`: baselines 26 a 30 tomados antes
     del cambio; el `compare` queda pendiente del despliegue.
   - [x] Capturas a 390 y 1440 px sin scroll horizontal.
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
