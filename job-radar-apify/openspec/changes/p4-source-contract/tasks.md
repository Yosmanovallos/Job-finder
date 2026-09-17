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

## 5. Canario y verificación post-despliegue

La regla de P3, sin excepciones: **un `success` no leído no es evidencia.**

- [ ] Ejecutar el tick CO y esperar cierre ordenado.
- [ ] **Leer el log completo**, no el código de salida. El segundo canario de
      P3 destapó una regresión que el primero ocultó, así que se ejecutan
      **dos** y se comparan entre sí.
- [ ] `scripts/verify-p4-source-contract.ts` antes y después, fuente por
      fuente: ninguna pasa de `success` a `blocked`/`empty`, ningún volumen
      de listado cae.
- [ ] **SRC-003, evidencia obligatoria:** comprobar si aparece
      `Computrabajo-detail` en `source_circuit_state`, o si sus intentos
      pasan a `empty` de forma consistente. Cualquiera de los dos vale; que
      todo siga indistinguible de «va bien», no.
- [ ] Declarar explícitamente la cobertura: **~13 de 17**. Glassdoor-CO/VE e
      Indeed-CO/VE tienen n=1 y viven en `scrape-browser-tick.yml` (cada 2
      días, sin verificar desde P3). **No** reportar «17/17 en verde».
- [ ] SRC-005 y SRC-006 se cierran con prueba, no con canario — declarado en
      la spec por adelantado.

## 6. Cierre

- [ ] Presentar los resultados del canario al usuario.
- [ ] **Esperar su OK explícito.** El merge a `main` no ocurre antes.
- [ ] Merge fast-forward a `main`; Render auto-despliega.
- [ ] Verificación post-despliegue (canario + lectura de log otra vez).
- [ ] Archivar el cambio en `openspec/changes/archive/p4-source-contract/`.
- [ ] Actualizar `docs/PROD-IMPROVEMENTS-PLAN.md`: fila de estado de P4 y
      entrada en la bitácora.
- [ ] Registrar como **input de P5**: Jooble ausente de `KNOWN_SOURCES`
      (14 recibidas → 0 válidas) y el orden de adopción derivado del fallo de
      detalle — Computrabajo (102→0) → Computrabajo-VE (22→0) →
      LinkedIn/LinkedIn-VE → resto.
- [ ] Recordar, sin hacerlos, los pendientes que no son de esta fase:
      revisión del cron `*/30` el 2026-09-22 (ADR 0003), recalibración de
      `SOURCE_LISTING_ESTIMATE_MS` (datos de hoy en `design.md` §1.7),
      `OPS_ADMIN_TOKEN` en `.env.example` de `main`.
