# Validación: Resume Studio R4 (2026-11-21)

Rama `codex/resume-studio-r4`, cortada de `codex/resume-studio-r3` en
`1b1373a`. No se usaron dinero real ni llaves sandbox: todos los eventos de
Wompi son fixtures firmados con el secreto sintético del runner
(`WOMPI_EVENTS_SECRET=p0-synthetic-events-secret`). Nada se corrió contra
Supabase ni contra la base del `.env`.

## Gates

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ sin errores |
| `npm run build` | ✅ el CSS global sigue en `index-BeuqwIzT.css` (sha256 `1d7ac0969c32df8a…`), igual que en R3 |
| `npm run test:resume-studio` | ✅ 10 archivos unitarios y 5 de integración. Incluye `validate-resume-studio-pay.test.ts` (10 pruebas), `validate-resume-studio-r4.ts` y T-FREE |
| `npm run test:integration` | ✅ exit 0 |
| `npm run test:unit` | ⚠️ se detiene en **JPD-001** (heredado, `validate-job-page-blocks.test.ts`), igual que en R3. El arreglo es #148, ya en `main` pero no en `codex/resume-studio`. Con `e7e49e1` (#148) aplicado temporalmente: ✅ exit 0, 696 pruebas sin fallos. El cherry-pick se retiró y no forma parte de la rama |
| T-FREE | ✅ dentro de `test:resume-studio` y de `test:integration` |
| `test:paywall` / `test:payment-flow` | ⛔ **no se corrieron**. Ambos leen el `.env` (la base de producción) y `test:paywall` además usa Supabase Auth y `clearRepository`. Sus escenarios de pago (firma alterada sin cambio de tier, aprobado → `pro`, reintento idempotente, `pro_max`) se repiten en `validate-resume-studio-r4.ts` contra el Postgres desechable |

## Pruebas T-PAY (Postgres desechable, `validate-resume-studio-r4.ts`)

| Prueba | Qué se comprueba |
|---|---|
| **T-PAY-1, aprobado** | La fila pasa a `approved` y se crea un solo `rs_entitlements` (`pass_1m`, 30 días, 30 adaptaciones). `users.subscription_tier` y `subscription_end` no cambian |
| **T-PAY-2, rechazado** | Con `DECLINED` o `ERROR`, la fila del pase queda en `declined` o `error`, sin pase. En una suscripción, `DECLINED` sigue siendo un no-op, como antes |
| **T-PAY-3, duplicado** | Los reintentos secuenciales y 8 entregas concurrentes dejan 1 `approved` y 7 `already_approved`. Se crea un solo pase y su vigencia no cambia |
| **T-PAY-4, monto alterado** | Se probaron 4 variantes con firma válida: 100, −1 centavo, el doble y `USD`. Todas dan `amount_mismatch`: la fila sigue `pending`, sin `wompi_transaction_id` y sin pase. Una suscripción `pro_max` con un monto alterado tampoco sube de tier (H2) |
| **T-PAY-5, firma inválida** | Se rechazan la firma alterada, la corta, la vacía y la hecha con otro secreto (`verified:false`). Nada cambia, ni en pases ni en suscripciones |

También se comprobó:

- **Suscripción:** `pro` y `pro_max` suben el tier por 30 días y son
  idempotentes. Una fila creada antes de la columna `product` se lee como
  `subscription`. Una referencia desconocida es un no-op. Ninguna
  suscripción crea pases.
- **Pases acumulables:** el segundo pase empieza cuando vence el primero.
- **Cupo atómico:** 20 consumos concurrentes dan exactamente 10 del pase,
  2 gratis, y niegan el resto.
- **Checkout:**
  - `404` con la bandera apagada.
  - `403` sin las autorizaciones.
  - `400` para `pro`, `pro_max`, vacío, numérico o un pase con inyección.
  - El monto sale del catálogo e ignora el del cliente.
  - `503` con llaves `pub_prod_` (solo sandbox hasta R5).
- **Confirmación por API de Wompi** (con `fetch` inyectado):
  - `PENDING` no desbloquea.
  - Una referencia ajena responde `404`.
  - Un monto distinto responde `409`.
  - Wompi sin respuesta da `502`; un id con `../` da `400`.
  - `APPROVED` crea el pase. El webhook que llega después es
    `already_approved`.
- **DOCX:** `402 pass_required` sin un pase vigente; con pase, un archivo
  Word válido. Un body inválido responde `400`.
- **`/tailor/start`:**
  - Sin cupo responde `402 quota_exhausted`.
  - El pase se consume antes que el cupo gratis.
  - Las tarjetas no consumen.
  - «Borrar todo» y «revocar» no reinician el cupo ni borran los pases.
  - Con la IA apagada no se consume cupo.
- **Esquema:** el bloque es idempotente, RLS está activo, no hay permisos
  para `anon`/`authenticated`, y el CHECK de `product` rechaza otros valores.

## Pruebas unitarias (`validate-resume-studio-pay.test.ts`)

- **Firma (H1):**
  - La fórmula documentada y el checksum en mayúsculas verifican bien.
  - Se rechazan sin lanzar error un monto alterado, otro secreto o un secreto
    ausente, checksums de longitud o forma inválidas, propiedades vacías o
    raras y un `timestamp` ausente.
  - El código fuente usa `crypto.timingSafeEqual`.
- **Catálogo:** precios 6.900, 14.900 y 29.700; cupos 10, 30 y 30 por
  periodo de 30 días; solo el de 3 meses es «Recomendado»; los ids
  desconocidos se rechazan.
- **Ventanas:** periodos de 30 días dentro del pase de 90 días. El cupo
  gratis va por mes calendario de Colombia, con el borde de UTC−5.
- **Llaves:** solo sandbox; el host queda fijo por el prefijo; la firma de
  integridad sigue la fórmula existente.
- **API de Wompi:** URL fija de sandbox y forma estricta de la respuesta. El
  id devuelto debe coincidir con el pedido; un id inválido nunca se consulta.
- **DOCX:**
  - Se escapa `<script>` y el XML inyectado.
  - Se eliminan los caracteres de control.
  - El ZIP almacenado es válido: las 5 partes con su CRC, y la salida es
    determinista.

## Hallazgos y decisiones

- **H1:** `src/payments/wompi-signature.ts`. La comparación es en tiempo
  constante y el checksum se normaliza a minúsculas. El código anterior, con
  `===`, habría rechazado un checksum en mayúsculas.
- **H2 e idempotencia:** `src/payments/approve.ts`. Todo pasa en una
  transacción: `SELECT … FOR UPDATE`, comparación del monto y la moneda,
  `UPDATE` y el `rs_entitlements` del pase. Un monto alterado responde 200
  `{status:"ignored"}` para que Wompi no reintente un evento que nunca será
  válido.
- **Cambio de comportamiento en la suscripción:** H2 ahora también protege a
  la suscripción, a propósito (doc 06 §7, punto 4). Lo demás sigue igual: un
  evento no aprobado es un no-op, y la subida de tier ocurre después del
  commit.
- `transactions.product` está en el bloque `resume-studio`, que es
  condicional si `transactions` no existe. **En R5 hay que migrarlo antes de
  desplegar**, porque el webhook lee esa columna.
- **Cupo gratis:** `RESUME_FREE_ADAPTATIONS = 2` por mes. Lo decide el
  propietario; la tarea y los docs no lo fijan.
- **PDF:** se genera con la impresión del navegador y lleva marca de agua si
  no hay pase. Quitarla desde el navegador es el riesgo que ya acepta el
  doc 06 §6. El DOCX sí se controla en el servidor.
- **Pantalla de pase:**
  - No lista «3 plantillas» (gratis desde R1) ni «Mis postulaciones» (R4b).
  - Muestra el precio con «IVA incluido», sin desglose (la condición
    tributaria sigue abierta).
  - El texto de retracto es provisional (D4, abogado).
- **Pendiente de revisar en pantalla:** la vista del pase y la marca de agua
  no se revisaron con una sesión real (escritorio y 375 px).
