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
- [x] Tras el merge: lanzamiento manual (`35046815422`, `58098d8`) y
      comparación fuente por fuente con `scripts/verify-p3-deadlines.ts`
      (solo lectura, reutilizable para el canario de Node 24):

      | Fuente | Antes `5d41861` | Después `58098d8` |
      |---|---|---|
      | Computrabajo | success/ok (8) | success/ok (22) |
      | Elempleo | success/ok (12) | success/ok (32) |
      | LinkedIn | success/ok (79) | success/ok (139) |
      | Torre | success/ok (61) | success/ok (72) |
      | Magneto | success/ok (19) | success/ok (20) |
      | GetOnBoard | success/ok (24) | success/ok (24) |
      | RemoteOK | success/ok (1) | success/ok (1) |
      | WorkanaV2 | ausente | success/ok (57) |

      **Cero regresiones:** ninguna fuente pasa de `success` a
      `blocked`/`empty` ni desaparece. El salto Node 20 → 24 NO entra en
      este despliegue, así que este canario aísla P3.
- [x] Verificar: canario `success` (ningún `cancelled`), **18m34s** < 20 min,
      y Computrabajo / Elempleo / Magneto presentes en el informe.
      **Matiz honesto:** el paso de `timeout` a `partial` NO es atribuible
      solo a P3 — la ejecución de las 00:47, con código pre-P3, también salió
      `partial` en 14m48s, así que las 23:28 (`timeout`, 20m04s) era el peor
      caso, no el invariable. Con una sola ejecución lo demostrado es que P3
      no rompe nada y que el tick termina por su cuenta dentro del
      presupuesto. Que el `timeout` desaparezca de forma sostenida requiere
      varios días de `scrape_runs`.
      Los conteos tampoco son comparables como volumen: cada tick procesa los
      roles vencidos en ese momento. La señal limpia es el **estado** por
      fuente, no la cifra.

## 5. Publicación

- [x] Gates en verde y OK explícito del usuario (condicionado a no dañar producción; ver decisión de separar Node 24).
- [x] Subido el commit de documentación pendiente (`6de3abe`) con el primer
      push de la fase.
- [x] Merge fast-forward a main (`5d41861..58098d8`, 25 archivos, +2167/−176). Render desplegado y sano: `/api/health`, `/api/runs` y `/` en 200.
- [x] Lanzamiento manual del tick y verificación del §4.
- [x] Archivado en `openspec/changes/archive/` y actualizado
      `docs/PROD-IMPROVEMENTS-PLAN.md` (estado, commit, historial).
- [x] Experimento de cadencia `*/30` anotado con revisión el **2026-09-22**.
      Si no mejora, revertir (una línea por workflow) y escalar al ADR 0003.
