# Spec delta — fuentes: contrato de resultado y transporte (P4)

Requisitos observables. Cada ID lleva **su método de verificación en línea**
(unitaria / integración / canario+log), porque la lección de P3 fue que un
código de salida en verde no es una verificación: hay que decir por
adelantado qué evidencia cuenta para cada requisito.

Pruebas: `tests/validate-source-contract.test.ts` (unitaria),
`tests/validate-source-contract.ts` (integración, PostgreSQL 16 desechable).
Medición en producción: `scripts/verify-p4-source-contract.ts` (solo lectura).

Delta: solo comportamiento que cambia. La clasificación de intentos de P2
(OBS-001…012) y los plazos de P3 (EXE-001…010) se mantienen intactos y
sirven de instrumento de medida.

**Base medida (2026-09-16, ventana de 7 días, producción):** 17 fuentes,
0 listados omitidos por presupuesto, ~236 `success` de listado frente a ~4
no-`success`, y todo el fallo concentrado en la etapa `detail`. Cero
apariciones de `blocked`, `rate_limited`, `quota_exhausted`, `misconfigured`
y `schema_changed` pese a que `source_attempts` los admite desde P2.

---

## SRC-001 — Una fuente comunica qué pasó, no solo cuántos datos trajo

El contrato de una fuente debe poder expresar el desenlace de un intento de
forma explícita: datos, estado, contadores por etapa y error clasificado. Un
resultado sin datos debe decir **por qué** no los hay.

- Escenario: la fuente responde con vacantes → `outcome: "success"`, `data`
  no vacío.
- Escenario: la fuente responde correctamente y no hay vacantes →
  `outcome: "empty"`, sin error.
- Escenario: la fuente entrega parte de lo pedido y algo explica el resto →
  `outcome: "partial"`, con `data` no vacío **y** error clasificado a la vez.
  Es el desenlace más frecuente de la etapa de detalle en los datos reales
  (LinkedIn 28, LinkedIn-VE 17, Computrabajo 9), y colapsarlo en `success`
  volvería a perder justo lo que esta fase conserva.
- Escenario: la fuente deniega (401/403) → `outcome: "blocked"` con
  `error.statusCode`, y `data` vacío que **no** puede confundirse con
  `empty`.
- Escenario: la fuente responde pero el parseo ya no reconoce la forma →
  `outcome: "schema_changed"`, nunca `empty`.
- Escenario: falta la credencial → `outcome: "misconfigured"`, nunca `empty`.
- Escenario: el error clasificado nunca contiene el mensaje crudo ni la URL
  (pueden llevar credenciales) — solo `class`, `statusCode`, `retryAfterMs`.

**Verificación:** unitaria (tabla de desenlace → clasificación, incluido el
caso adversario de un mensaje de error con credencial embebida, que debe
quedar fuera del objeto).

---

## SRC-002 — La adopción es gradual: ningún adaptador se rompe

Los adaptadores que devuelven `Job[]` deben seguir funcionando sin
modificarse. El contrato nuevo entra por los puntos compartidos del wrapper;
la migración adaptador por adaptador es de P5.

- Escenario: los 17 adaptadores actuales, sin tocar, siguen produciendo
  vacantes y clasificándose exactamente como antes del cambio.
- Escenario: un adaptador migrado convive en el mismo registro con 16 sin
  migrar, en la misma ejecución.
- Escenario: el envoltorio de compatibilidad **no inventa** desenlaces que el
  adaptador no dio — un `Job[]` vacío sigue clasificándose `empty`, igual que
  hoy, porque un adaptador sin migrar no tiene forma de decir otra cosa.
- Escenario: `executeWithResilience` conserva su firma `Promise<T[]>` y la
  tubería de reputación (que la comparte) no requiere ningún cambio.

**Verificación:** unitaria (envoltorio y equivalencia de clasificación) +
integración (ejecución mixta: 1 migrado + 16 sin migrar) + canario (las
fuentes sin migrar no cambian de estado ni pierden volumen).

---

## SRC-003 — Un detalle ausente no cuenta como éxito del circuito

**Éste es el hallazgo principal de P4.**

Cuando la búsqueda de detalle de una vacante no produce detalle, el circuito
de esa fuente **no puede** registrarlo como éxito. Un desenlace vacío es
neutro para el circuito: ni reinicia el contador de fallos ni lo incrementa.
Solo un éxito real reinicia; solo un fallo real incrementa.

**Base medida (2026-09-16, 7 días, producción):**

`source_circuit_state` contiene exactamente 4 filas — `Glassdoor` (0),
`GlassdoorV2` (1), `Indeed` (0), `Workana` (2) — y **ninguna termina en
`-detail`**. Como `recordFailure` hace `INSERT ... ON CONFLICT DO UPDATE` y
`recordSuccess` solo hace `UPDATE`, la ausencia de la fila demuestra que
`recordFailure` **nunca** se ha invocado por la ruta de detalle en toda la
vida de la tabla.

Mientras tanto, en esa misma ventana:

| Fuente | Intentos de detalle | Páginas pedidas | Detalles obtenidos |
| --- | --- | --- | --- |
| Computrabajo | 24 | 102 | **0** |
| Computrabajo-VE | 8 | 22 | 0 en 4 de 8 intentos |

Causa, en dos líneas de código que se combinan:
`scrape-worker.ts` convierte `fetchDetail() === null` en `[]`, y
`resilient-fetch.ts` hace `if (Array.isArray(results)) { recordSuccess(...) }`.
Todo array, incluido el vacío, es un éxito. El circuito de detalle es, hoy,
inabrible.

- Escenario: `fetchDetail()` devuelve `null` → el intento se clasifica
  `empty`, y el contador de fallos del circuito **no se reinicia**.
- Escenario: `fetchDetail()` devuelve `null` → el contador de fallos tampoco
  **se incrementa** (una vacante puede legítimamente no tener detalle útil;
  convertirlo en fallo abriría circuitos sanos).
- Escenario: N intentos de detalle consecutivos con fallo real (excepción,
  deny, 429) alcanzan el umbral y **abren** el circuito de detalle, aunque
  entre ellos se hayan intercalado detalles nulos.
- Escenario: un detalle obtenido con éxito reinicia el contador.

**Escenario de aceptación en producción — forma falsable.** Un primer
borrador de este requisito aceptaba «aparece la fila `-detail` **o bien** los
intentos se clasifican `empty` de forma consistente». Esa disyunción no sirve
como gate: Computrabajo **ya** se clasifica `empty/no_detail` 12 veces hoy,
así que la segunda rama la satisface el comportamiento *anterior* al cambio.
Un criterio que se cumple sin desplegar nada no es un criterio.

La forma discriminante usa el hecho de que `recordFailure` hace `INSERT`: la
**existencia** de la fila es la señal, y lo que hay que decidir leyendo el log
es si hubo fallos reales que la justificaran.

- Escenario de aceptación: tras el canario se lee el log y se cuentan los
  fallos **reales** de detalle (excepción, deny, 429) de esa ejecución.
  Entonces, exactamente uno de estos dos debe ser cierto, y hay que decir
  cuál:
  - hubo ≥1 fallo real de detalle → la fila `<fuente>-detail` **existe** en
    `source_circuit_state` con `failures ≥ 1`;
  - no hubo ningún fallo real de detalle → la fila puede seguir sin existir,
    y entonces el requisito se cierra con la prueba de integración, no con
    el canario.
- Escenario de refutación (lo que haría fallar el requisito): hubo ≥1 fallo
  real de detalle en el log **y** no existe la fila correspondiente. Eso
  significaría que el desenlace vacío sigue borrando el historial.

**Verificación:** unitaria (la máquina de estados del circuito: neutro no
reinicia, neutro no incrementa, fallo incrementa, éxito reinicia) +
integración (secuencia de N nulos + M fallos contra PostgreSQL desechable,
comprobando las filas reales de `source_circuit_state`) + **canario con
lectura de log** (aparición de la fila `-detail`; el código de salida del
workflow no cuenta como evidencia de este requisito).

---

## SRC-004 — El circuito de detalle tiene política propia

Listado y detalle ya usan filas distintas de `source_circuit_state`
(`X` frente a `X-detail`). Lo que hoy comparten es la **política**:
`FAILURE_THRESHOLD = 3` y `DEGRADED_TIMEOUT_MS = 30 min` son constantes de
módulo. P4 las hace parametrizables por (fuente, etapa).

> Corrección al borrador de la propuesta: decía «un circuito por fuente,
> compartido entre listado y detalle». Es inexacto — están separados desde
> que la ruta de detalle pasa `${adapter.name}-detail`. Lo compartido es la
> política, y eso es lo que cambia aquí.

- Escenario: el detalle de una fuente abre su circuito y su **listado sigue
  ejecutándose** con normalidad en el mismo tick.
- Escenario: el listado de una fuente abre su circuito y su detalle no se
  ve arrastrado.
- Escenario: una fuente sin política declarada usa los valores de hoy (3 /
  30 min) y se comporta **exactamente** igual que antes del cambio.
- Escenario: una fuente con umbral propio para detalle lo respeta sin afectar
  al de listado.

**Verificación:** unitaria (resolución de política por (fuente, etapa) y
defaults) + integración (apertura de un circuito y no-contaminación del otro,
contra filas reales).

---

## SRC-005 — `Retry-After` se respeta donde la fuente lo envía

Cuando una fuente responde 429 con `Retry-After`, la espera debe respetarse,
acotada por el presupuesto restante del tick.

- Escenario: 429 con `Retry-After: 30` y presupuesto suficiente → se espera
  lo pedido y se reintenta.
- Escenario: 429 con `Retry-After` **mayor que el presupuesto restante** → no
  se duerme; el intento se abandona clasificado (`rate_limited`). Dormir
  30 s cuando quedan 5 garantiza un reintento muerto al nacer.
- Escenario: 429 con `Retry-After` absurdo (p. ej. 1 h) → se recorta al tope
  declarado en la política antes de considerarlo.
- Escenario: 429 sin cabecera `Retry-After` → se cae al backoff exponencial
  actual (1 s, 3 s, 9 s), sin cambio de comportamiento.
- Escenario: el intento se clasifica `rate_limited`, no `failed`.

**Verificación:** **solo unitaria, con fixture.** Se declara por adelantado
que este requisito **no** tendrá evidencia de canario: hubo **0 intentos
`rate_limited` en 7 días** de producción, así que no hay forma honesta de
provocarlo sin abusar de una fuente real — cosa que no se va a hacer. El
gate se cumple con prueba o no se cumple.

---

## SRC-006 — El transporte es una política declarada, no una decisión incrustada

Cada (fuente, etapa) declara su transporte: directo por defecto, proxy solo
donde esté explícitamente declarado y autorizado.

- Escenario: una fuente sin transporte declarado usa conexión directa.
- Escenario: activar el proxy **no cambia el comportamiento de ninguna
  fuente que no lo declare**.
- Escenario: una fuente que declara proxy pero no tiene credencial
  configurada se clasifica `misconfigured` — no lo intenta en directo por su
  cuenta, y no se clasifica `empty`.
- Escenario: las credenciales del proxy no aparecen en logs, ni en
  `source_attempts.error_class`, ni en ningún mensaje de error.
- Escenario: el nombre de variable existente (`WEBSHARE_PROXY_URL`) se
  conserva; la ruta de navegador lo lee desde la política en vez de desde
  `process.env` en el punto de uso.

**Verificación:** unitaria (resolución de transporte, redacción de
credenciales) + integración (fuente con proxy declarado y sin credencial →
`misconfigured`). Sin canario para la ruta de proxy: ver SRC-009.

---

## SRC-007 — Los límites por fuente están centralizados

El techo de peticiones por intento deja de estar repartido por los
adaptadores y pasa a resolverse desde la política.

- Escenario: una fuente con techo declarado no emite más peticiones que ese
  techo en un intento, y lo que queda fuera se contabiliza como `filtered`,
  no como inexistente.
- Escenario: una fuente sin techo declarado mantiene el comportamiento
  actual, incluido el tope vigente de 8 páginas de detalle por adaptador y
  rol (AGENTS.md #12, ningún bucle sin límite).

**Verificación:** unitaria (resolución de límites) + integración (recuento de
peticiones emitidas frente al techo).

---

## SRC-008 — «Todo rechazado por validación» es un desenlace propio

Que una fuente entregue vacantes y que **todas** sean descartadas por la
validación es un desenlace distinto de «no había vacantes», y debe
distinguirse por tipo y no por heurística.

**Base medida:** `Jooble` — 3 intentos, 14 recibidas, **0 válidas**, hoy
clasificado `failed / all_rejected_by_validation`. Causa: es la **única**
fuente estampada que falta en `KNOWN_SOURCES` (`src/db/job-validator.ts`).

- Escenario: `received > 0` y `valid === 0` → desenlace clasificado con
  `received` y `valid` visibles en el intento, nunca `empty`.
- Escenario: `received > 0` y `valid > 0` → `success`, con la diferencia
  contabilizada como `filtered`.

**Fuera de alcance de P4: reparar Jooble.** La reparación de adaptadores es
P5, una fuente por entrega (AGENTS.md ground rule #1). Aquí solo se garantiza
que el desenlace sea legible. Jooble queda registrado como **input de P5** en
el plan maestro.

**Verificación:** unitaria (clasificación) + medición en producción con
`verify-p4-source-contract.ts` (el caso ya está ocurriendo; no hay que
provocarlo).

---

## SRC-009 — Lo que el canario puede y no puede probar

Declarado por adelantado, como parte de la spec y no como excusa posterior.

- Escenario: el canario cubre las ~13 fuentes que aparecen con `n > 1` en la
  ventana de 7 días.
- Escenario: **Glassdoor-CO/VE e Indeed-CO/VE tienen n=1** y viven en
  `scrape-browser-tick.yml`, que corre cada 2 días y que P3 dejó **sin
  verificar**. Ninguna afirmación sobre la ruta de navegador —ni sobre el
  proxy, que es la ruta que la usa— queda respaldada por esta ventana.
- Escenario: el informe de cierre no dice «17/17 en verde». Dice qué se
  observó, en qué fuentes, y qué quedó sin observar.
- Escenario: todo desenlace `success` del canario se acepta **solo tras leer
  el log**. El código de salida no es evidencia (lección de P3: el segundo
  canario destapó una regresión que el primero ocultó).

**Verificación:** procedimiento de cierre en `tasks.md`; se comprueba leyendo
el informe final, no ejecutando nada.

---

## Trazabilidad

| ID | Requisito | Verificación | Evidencia de canario |
| --- | --- | --- | --- |
| SRC-001 | Desenlace explícito | unitaria | indirecta |
| SRC-002 | Adopción gradual | unitaria + integración + canario | sí |
| SRC-003 | **Detalle nulo ≠ éxito de circuito** | unitaria + integración + **canario con lectura de log** | **sí, obligatoria** |
| SRC-004 | Política por (fuente, etapa) | unitaria + integración | indirecta |
| SRC-005 | `Retry-After` | **solo unitaria (fixture)** | **no — 0 casos en 7 días** |
| SRC-006 | Transporte declarado | unitaria + integración | **no — ruta navegador sin verificar** |
| SRC-007 | Límites centralizados | unitaria + integración | indirecta |
| SRC-008 | Rechazo total por validación | unitaria + medición | sí (Jooble ya lo produce) |
| SRC-009 | Alcance del canario | revisión del informe | n/a |
