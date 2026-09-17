# Tareas — P4: contrato de fuentes y transporte

Checklist de ejecución. Orden obligatorio: **las pruebas que fallan primero**,
después la implementación, después las validaciones, después la publicación.

Estado: **§0-§4 completos (gates en verde). §5 canario pendiente de
ejecutar; §6 espera el OK explícito del usuario.**

---

## 0. Medición previa (✅ completo, 2026-09-16)

- [x] Escribir `scripts/verify-p4-source-contract.ts` — solo lectura, cada
      consulta es un `SELECT` sobre `source_attempts` / `source_circuit_state`.
- [x] Ejecutarlo contra producción desde `Job-finder/job-radar-apify` (donde
      vive el `.env`), invocando el script por su ruta absoluta en el
      worktree. Sin escrituras, sin uso de la BD para pruebas.
- [x] **Resultado que tira abajo la premisa del borrador:** 0 listados
      omitidos por presupuesto en 7 días. El orden de adopción no puede salir
      de ahí.
- [x] **Resultado que fija el hallazgo principal:** `source_circuit_state`
      tiene 4 filas y ninguna `-detail`, con Computrabajo en 102 páginas → 0
      detalles. El circuito de detalle es inabrible (SRC-003).
- [x] Calibrar `BUDGET_ESTIMATES.detailFetch` con percentiles por intento
      (p50 3454 / p95 5816 / max 7312 ms) → **se queda en 8000 ms**, que está
      por encima del máximo observado. Corrige una lectura previa basada en
      la media, que sugería bajarlo.
- [x] Anotar la deriva de `SOURCE_LISTING_ESTIMATE_MS` (LinkedIn +50 %,
      LinkedIn-VE +53 %) como dato para el pendiente del usuario. **No
      aplicarla en P4.**

## 1. Artefactos de especificación (✅ completo)

- [x] `design.md` — contratos, datos medidos, compatibilidad, rollback,
      riesgos, no-objetivos.
- [x] `specs/sources/spec.md` — SRC-001…009 con método de verificación en
      línea por requisito.
- [x] `tasks.md` (este archivo).
- [x] Actualizar `proposal.md` con las dos correcciones que los datos
      obligan: la premisa del presupuesto (no hay starvation) y la afirmación
      de que los circuitos están «compartidos» (están separados; lo compartido
      es la política).

## 2. Pruebas que fallan primero (✅ completo)

- [x] `tests/validate-source-contract.test.ts` (unitaria):
  - [x] SRC-001: tabla desenlace → clasificación, incluido el caso
        adversario de un error con credencial embebida (no debe filtrarse).
  - [x] SRC-002: `liftJobArray` produce la clasificación de hoy, ni más ni
        menos; `executeWithResilience` conserva su firma `Promise<T[]>`.
  - [x] **SRC-003: máquina de estados del circuito** — neutro no reinicia,
        neutro no incrementa, fallo incrementa, éxito reinicia. Esta prueba
        debe **fallar contra el código actual**: hoy un `[]` reinicia.
  - [x] SRC-004: resolución de política por (fuente, etapa) y defaults
        idénticos a 3 / 30 min.
  - [x] SRC-005: `Retry-After` respetado, recortado al presupuesto,
        recortado al tope de política, ausente → backoff actual.
  - [x] SRC-006: transporte por defecto directo; proxy declarado sin
        credencial → `misconfigured`; credenciales redactadas.
  - [x] SRC-007: techo de peticiones por intento.
  - [x] SRC-008: `received > 0 && valid === 0` es su propio desenlace.
- [x] `tests/validate-source-contract.ts` (integración, PostgreSQL 16
      desechable vía runner aislado):
  - [x] SRC-003 contra filas reales de `source_circuit_state`: N nulos + M
        fallos → la fila existe y `failures` es el esperado.
  - [x] SRC-004: abrir el circuito de detalle no detiene el listado y
        viceversa.
  - [x] SRC-002: ejecución mixta, 1 adaptador migrado + 16 sin migrar.
- [x] Confirmar que las pruebas nuevas **fallan** antes de implementar.
      Comprobado: `ERR_MODULE_NOT_FOUND … src/sources/fetch-result.js`,
      suite en rojo antes de escribir una sola línea de implementación.

## 3. Implementación (✅ completo)

Por los puntos compartidos primero; los adaptadores casi no se tocan.

- [x] `src/sources/fetch-result.ts` — `SourceFetchResult<T>`,
      `SourceOutcome`, `SourceFetchCounters`, `SourceFetchError`,
      `liftJobArray()`.
- [x] `src/sources/source-policy.ts` — `SourcePolicy` por (fuente, etapa),
      defaults iguales al comportamiento actual, `resolvePolicy()`.
- [x] `src/engine/rate-limit.ts` — `FetchRateLimitedError` siguiendo el
      precedente de `FetchBlockedError`.
- [x] `src/engine/resilient-fetch.ts`:
  - [x] `executeWithResilienceResult()` nuevo.
  - [x] `executeWithResilience()` pasa a ser shim sobre él, **misma firma**
        (la tubería de reputación no se entera).
  - [x] **SRC-003:** `recordSuccess` solo en éxito real; desenlace vacío es
        neutro para el circuito.
  - [x] Umbral y ventana desde `SourcePolicy`, no desde constantes de módulo.
  - [x] `Retry-After` vía `sleepWithContext` (ya recorta al presupuesto).
- [x] `src/queue/scrape-worker.ts` — la ruta de detalle distingue
      `empty` de `failed` en vez de colapsar `null` en `[]`.
- [x] `src/engine/browser-fetch.ts` — transporte desde la política; se
      conserva el nombre `WEBSHARE_PROXY_URL`.
- [x] `src/sources/torre.ts` — **único** adaptador migrado, como
      demostración del gate de adopción gradual (pequeño, sin `fetchDetail`,
      50/50 `success`).
- [x] Verificar que los otros 16 adaptadores **no aparecen en el diff**.

## 4. Validaciones (gates)

Ejecutadas desde `job-radar-apify` con el runner aislado y Docker local.
Nunca contra la base de producción.

- [x] `npm run test:unit` — incluidas las nuevas; P2/P3 intactas.
- [x] `npm run test:integration`.
- [x] `npm run test:baseline`.
- [x] `npm run build`.
- [x] `npx tsc` → **29**, línea base heredada, **0 nuevos**.
- [x] `npx eslint` → **294**, un error preexistente menos que los 295
      heredados, **0 nuevos** (desglose abajo).
- [x] Reportar heredados y nuevos **por separado**, siempre.

**Resultados medidos (2026-09-16):**

| Gate | Resultado |
| --- | --- |
| `test:unit` | **18/18** nuevas en verde; P3 15/15 y P2 intactas |
| `test:integration` | **7/7** nuevas (SRC-002/003/004) + OBS-001…012 + EXE-003…009 |
| `test:baseline` | 9 rutas ✅ |
| `build` | ✅ `built in 2.07s` |
| `tsc` | **29** = línea base heredada, **0 nuevos** |
| `eslint` | **294** frente a 295 heredados → **0 nuevos, 1 preexistente eliminado** |

Verificación del recuento de eslint, porque un total que *baja* también hay
que explicarlo: los 6 archivos modificados sumaban **11** errores en `HEAD`
y suman **10** tras P4 — `resilient-fetch.ts` queda limpio al reescribirse.
Los 8 archivos nuevos no aportan **ningún** error. Comprobado restaurando
las versiones de `HEAD` junto a las nuevas y pasando `eslint` a ambas.

> Nota de método: una primera comprobación usó `eslint -f unix`, que no está
> instalado en este proyecto. El comando falló y su salida vacía se leyó
> como «0 errores en los archivos de P4». Se rehízo con el formateador por
> defecto, que es el que produjo la tabla de arriba. Un comando que falla no
> es una comprobación que pasa — la misma lección que el canario de P3.

## 5. Canario (✅ ejecutado sobre la rama, 2026-09-17)

Lanzado con `workflow_dispatch` sobre `codex/prod-improvements-seo-ux-security`
**antes** del merge, no después. Dos ejecuciones, comparadas entre sí y contra
las dos anteriores de `main` (`6ba16ea`, pre-P4).

| | Canario 1 | Canario 2 |
| --- | --- | --- |
| Run | `35171209713` | `35173002214` |
| Commit | `f0b0016` | `f0b0016` |
| Conclusión | `success` | `success` |
| Cierre ordenado | ✅ `Finalizado en 812s` | ✅ `Finalizado en 793s` |
| Roles / timeouts | 8 / 1 | 8 / 1 |
| Estado del tick | `partial / some_sources_degraded` | `partial / some_sources_degraded` |
| Menciones de Circuit Breaker | **0** | **0** |
| `Detalle fallido` en log | **0** | **0** |

- [x] Dos ejecuciones comparadas entre sí, no una.
- [x] Log completo leído en ambas. El cierre ordenado se ejecuta (drenaje de
      60 s + `Finalizado en`), ninguna supera los 20 min, ninguna muere por
      hard-kill.
- [x] **`partial / some_sources_degraded` NO es una regresión de P4:** las dos
      ejecuciones anteriores de `main` sin P4 (01:33 y 23:03) salieron con el
      mismo estado y motivo. Verificado con `verify-p3-deadlines.ts`.
- [x] Ninguna fuente pasa de `success` a `blocked`/`empty`. En los dos
      canarios **no hay un solo listado `empty` ni `blocked`**; el pre-P4 de
      las 23:03 sí tenía uno (`Remotive → empty`).

**Comparación por fuente (listado).** Los totales absolutos dependen de
cuántos roles tocó la cadencia a cada fuente en ese tick, así que se compara
la tasa por rol:

| Fuente | pre-P4 (recib/roles) | Canario 1 | Canario 2 | Estado |
| --- | --- | --- | --- | --- |
| Computrabajo | 179/2 = 90 | 210/4 = 53 | 43/4 = 11 | `success` en los 3 |
| Elempleo | 197/4 = 49 | (no tocaba) | 186/5 = 37 | `success` |
| LinkedIn | 1373/8 = 172 | 606/5 = 121 | 342/3 = 114 | `success` |
| Magneto | 40/2 = 20 | 80/4 = 20 | 120/6 = 20 | `success` |
| **Torre** | 299/2 = 150 · 386/6 = 64 | 291/5 = 58 | 224/3 = 75 | `success` |

`valid == received` en todos los listados de ambos canarios (Torre 291/291 y
224/224): la migración no introduce pérdida por validación.

**Los tres límites documentados, verificados uno a uno:**

- [x] **SRC-003 en su forma falsable.** En los dos canarios los desenlaces de
      detalle fueron `empty`, `partial` y `success`; **cero** `failed`,
      `blocked` o `timeout`. Es decir: **no hubo ni un fallo real de
      detalle**, así que la rama correcta de la spec es la segunda — la fila
      `-detail` sigue legítimamente ausente y el requisito se cierra con la
      prueba de integración. `source_circuit_state` conserva sus 4 filas de
      siempre. **La condición de refutación (≥1 fallo real y ninguna fila) no
      se dio.**
- [x] **La mejora sí se observa en la clasificación.** Canario 1,
      Computrabajo detalle: `empty,partial` con 33 recibidas / 1 válida. El
      pre-P4 equivalente (01:33) fue `empty` a secas con 21 / 0. Antes todo
      colapsaba en `empty`; ahora el `partial` se distingue del vacío real.
- [x] **Torre devuelve `[]` sin degradar la clasificación.** En el log del
      canario 1 varias palabras clave dan `[Torre] Found 0 jobs`, y el
      agregado del adaptador migrado sigue siendo `success` con 291 vacantes.
      Un `[]` por palabra clave ya no arrastra al conjunto ni toca el
      circuito.
- [x] **El circuito `-detail` se comporta como especifica:** `empty` es
      neutro (no crea fila), `partial` y `success` reinician, y como no hubo
      incrementos no se abrió ningún circuito. Ninguna fuente quedó degradada
      por un detalle ausente — que es exactamente lo que P4 venía a arreglar.

- [x] Declarada la cobertura: **5 de 17 fuentes** observadas en estos dos
      canarios (Computrabajo, Elempleo, LinkedIn, Magneto, Torre). El resto no
      tocaba por cadencia. Glassdoor-CO/VE e Indeed-CO/VE siguen **sin
      verificar**: viven en `scrape-browser-tick.yml`, que corre cada 2 días.
      **No se afirma «17/17 en verde».**
- [x] SRC-005 y SRC-006 se cierran con prueba unitaria, no con canario, tal
      como la spec declaró por adelantado.

## 6. Cierre (✅ completo, 2026-09-17)

- [x] Resultados de los canarios presentados al usuario.
- [x] OK explícito recibido antes del merge.
- [x] Fast-forward a `main`: `6ba16ea..634a358`, **sin forzar**. Comprobado
      antes con `merge-base --is-ancestor` que `main` no había avanzado.
- [x] Verificación post-despliegue:
  - [x] `/api/runs` responde el contrato nuevo (`runs`/`count`/`nextCursor`,
        con `attempts`, `status`, `reason` por ejecución) y
        `/api/admin/runs` sigue dando **401** sin token.
  - [x] Tercer tick desde `main` (`35175143321`, commit `634a358`): cierre
        ordenado en **818 s**, 9 roles, `Timeouts: 1`, **0** menciones de
        Circuit Breaker, **0** fallos de detalle, **0** errores no
        controlados. Log leído entero, no solo el código de salida.
  - [x] `verify-p4-source-contract.ts` por fuente: las 6 fuentes del tick en
        `success` con `valid == received` (Computrabajo 373/373, Elempleo
        78/78, GetOnBoard 15/15, Magneto 60/60, RemoteOK 1/1, WorkanaV2
        72/72). Computrabajo detalle en `empty,partial` (70/1): la separación
        entre vacío real y parcial se mantiene tras el despliegue.
- [x] Cambio archivado en `openspec/changes/archive/p4-source-contract/`.
- [x] `docs/PROD-IMPROVEMENTS-PLAN.md`: fila P4 a ✅ Done con `634a358` y
      entrada de bitácora con los tres límites documentados.
- [x] Registrado como input de P5 (borrador en
      `openspec/changes/p5-adapter-recovery/`): Jooble ausente de
      `KNOWN_SOURCES`, el orden de adopción por fallo de detalle, y los tres
      límites heredados.
- [x] **Pendiente observado de P4, declarado y NO dado por cubierto:**
      Glassdoor-CO/VE e Indeed-CO/VE siguen sin verificar hasta que corra
      `scrape-browser-tick.yml` (cada 2 días).
- [x] Pendientes que no son de esta fase, solo recordados: revisión del cron
      `*/30` el 2026-09-22 (ADR 0003), recalibración de
      `SOURCE_LISTING_ESTIMATE_MS` (datos en `design.md` §1.7),
      `OPS_ADMIN_TOKEN` en `.env.example` de `main` (lo tiene el usuario).
