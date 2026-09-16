# Tareas — P3

Orden: pruebas que fallan primero → implementación → validación →
publicación. Una fase por sesión; nada se aplica a la base real ni se
despliega sin aprobación explícita del usuario.

## 0. Verificación heredada de P2

- [x] Confirmar por qué `scrape_runs` estaba vacía → **no era un defecto**:
      40/40 ejecuciones recientes usaron `74f066b` (base); ninguna usó
      `5d41861`. El código de P2 nunca se había ejecutado en Actions.
- [x] Lanzamiento manual de `scrape-jobs.yml` sobre main (autorizado por el
      usuario, run `35035795482`): ejecución registrada con fuentes
      clasificadas, tamaño real de `source_attempts`.
- [~] `OPS_ADMIN_TOKEN` en `.env.example`: **arrastrado, no cerrado.** El
      harness deniega toda lectura/escritura de esa ruta (regla de
      `.claude/settings.json`), y AGENTS.md prohíbe rodearla. Requiere que lo
      añada el usuario a mano:
      `OPS_ADMIN_TOKEN=` (≥40 caracteres; sin él `/api/admin/runs` responde
      401, que es el comportamiento fail-closed correcto).

## 1. Pruebas que fallan primero

- [x] `tests/validate-fetch-context.test.ts` (unitaria, sin BD):
      EXE-002 aritmética del presupuesto · EXE-003 nada nuevo tras el plazo ·
      EXE-004 backoff y jitter abortables · EXE-005 puntos abortables vs. no
      abortables con un adaptador falso que duerme.
- [x] `tests/validate-execution-deadlines.ts` (integración, PostgreSQL
      desechable): EXE-005 persist completado bajo plazo vencido ·
      EXE-006 salida limpia · EXE-007 reclamación concurrente ·
      EXE-008 rescan manual vs. lease vivo · EXE-009 informe parcial.
- [x] Registrar ambas en `scripts/run-isolated-tests.ts` (`unit`,
      `integration`).

## 2. Implementación

- [x] `src/engine/fetch-context.ts` — contrato nuevo (§1 del diseño).
- [x] `src/engine/jitter-delay.ts` — `ctx?`, espera abortable.
- [x] `src/engine/resilient-fetch.ts` — `ctx?`, presupuesto antes de cada
      reintento, backoff abortable. **Sin cambiar la firma que usa el
      pipeline de reputación.**
- [x] `src/queue/listing-attempt.ts` — presupuesto antes del fetch; el
      persist nunca se aborta (EXE-005).
- [x] `src/queue/scrape-worker.ts` — presupuesto por fuente y por detalle;
      `perSource` acumulado por el llamador (EXE-009).
- [x] `src/db/schema.sql` — `scrape_leases` aditiva + RLS + añadir al
      `REVOKE … FROM anon, authenticated`.
- [x] `src/db/scrape-leases.ts` — `claimLease` / `refreshLeases` /
      `releaseLease`; degradación con aviso si la tabla no existe.
- [x] `src/observability/run-telemetry.ts` — el latido de 60 s refresca los
      leases del `run_id`.
- [x] `scripts/run-scrape-tick.ts` — presupuesto derivado (§4), cierre
      acotado (§5), reclamación por fuente (§6).
- [x] `.github/workflows/{scrape-jobs,scrape-jobs-ve,scrape-browser-tick}.yml`
      — `npm ci` sin fallback y cron `*/30` (experimento §9).
- [ ] **Segundo despliegue:** Node 20 → 24 en los 3 workflows. Separado a
      propósito del merge de P3 (decisión del usuario, 2026-09-15): es el
      único cambio con riesgo real para producción y merece su propio
      canario. Comparar de nuevo `source_attempts` fuente por fuente.
- [x] `docs/adr/` — ADR de cadencia: evidencia de pérdida de disparos,
      recomendación de scheduler gestionado, pendiente de coste aprobado.

## 3. Validación

- [x] `npm run test:unit` · `test:integration` · `test:baseline` (Docker).
- [x] `npx tsc --noEmit -p .` desde `job-radar-apify`.
- [x] `npx eslint job-radar-apify` desde la raíz del worktree.
- [x] **Método del gate** (corregido en P2): diff por archivo y regla del
      mismo comando, antes y después. La línea base vigente es **tsc 29 /
      eslint 295** en todo el paquete (52 en `tests/`). La cifra "27" de P1
      correspondía a un alcance más estrecho no registrado y queda
      superada. Reportar heredados y nuevos por separado.
- [x] `npm run build`.
- [x] Migración: aplicada **solo** a base desechable (idempotente, RLS
      verificado). La base real sigue **sin migrar** — requiere autorización
      explícita del usuario.

## 4. Medida antes/después (con P2 como instrumento)

- [x] Línea base de esta sesión, con instrumentación P2 ya activa: run
      `35035795482` (23:28 UTC, `5d41861`, lanzamiento manual autorizado) →
      **`timeout (deadline_exceeded)`**, 143 vacantes nuevas, 20,8 min. Un
      intento de Elempleo también quedó `timeout / deadline_exceeded`.
      Fuentes 24 h: Computrabajo 7 ✅, Elempleo 5 ✅ +1 timeout, Magneto 5 ✅,
      LinkedIn 1 ✅, Torre 1 ✅, Jooble 1 `failed / all_rejected_by_validation`
      (hallazgo ya previsto en el plan, se corrige en P5/P6).
      Referencia previa sin P2: run `35031341207` (22:30 UTC, `74f066b`) —
      185 nuevas, 1901 duplicadas, 7 fuentes informadas, 262 s de gracia
      agotados y Computrabajo/Elempleo/Magneto ausentes del informe.
- [ ] Tras el merge: lanzamiento manual y comparación de `source_attempts`
      fuente por fuente. Atención especial al salto Node 20 → 24
      (`got-scraping`, `playwright`, defaults TLS de undici).
- [ ] Verificar: ningún `cancelled`, duración < 20 min, Computrabajo /
      Elempleo / Magneto presentes en el informe.

## 5. Publicación

- [ ] Gates en verde y OK explícito del usuario.
- [ ] Subir el commit de documentación pendiente (`6de3abe`) con el primer
      push de la fase.
- [ ] Merge fast-forward a main → Render despliega (~60 s).
- [ ] Lanzamiento manual del tick y verificación del §4.
- [ ] Archivar el cambio en `openspec/changes/archive/` y actualizar
      `docs/PROD-IMPROVEMENTS-PLAN.md` (estado, commit, historial).
- [ ] Anotar el experimento de cadencia `*/30` con fecha de revisión a 7
      días. Si no mejora, revertir y escalar al ADR.
