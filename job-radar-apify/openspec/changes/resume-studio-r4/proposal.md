# Resume Studio R4: pases Wompi, `rs_entitlements`, cupos y webhook H1/H2

**Estado:** en curso (2026-11-21).
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../docs/adr/0017-resume-studio-implementation.md) §5 y §6.
**Rama:** `codex/resume-studio-r4`, cortada de `codex/resume-studio-r3`
(PR #150). El PR va en borrador contra `codex/resume-studio`. Nada va a
`main` ni a Supabase.
**Guías:** doc 06 §3, §4, §6, §7 y §9.3; doc 08, hallazgos H1 y H2 y la
fila «Fraude de pago»; doc 11 §6; prototipo
`docs/resume-studio/mockups/resume-tailor-link-prototype.html` (vista
«Pase»).

## Problema

R3 deja el CV adaptado en el navegador. Aún no hay forma de pagar por la
descarga limpia ni de limitar las adaptaciones. El webhook de Wompi actual
tiene dos fallas conocidas:

- **H1:** compara el checksum con `===`.
- **H2:** no compara el monto aprobado con el guardado.

Además, cualquier fila que no sea `pro_max` termina en `upgradeUserToPro`.

## Alcance

### 1. Producto Wompi propio: `resume_pass`

Pases de **pago único, sin renovación automática**. Los precios incluyen
IVA y son **constantes en config** (`src/resume-studio/payments/passes.ts`),
porque el D2 sigue abierto:

| Pase (`passId`) | Precio | Vigencia | Cupo de adaptaciones |
|---|---|---|---|
| `pass_7d` | COP 6.900 | 7 días | 10 en el pase |
| `pass_1m` | COP 14.900 | 30 días | 30 en el periodo de 30 días |
| `pass_3m` | COP 29.700 (un solo cobro) | 90 días | 30 por cada periodo de 30 días |

- Ruta `POST /api/resume/checkout` con body `{ passId }`.
  - Responde 404 salvo que `RESUME_STUDIO_PAYMENTS=true`. No depende de
    `PAYWALL_ENABLED` (sigue en `false`) y no toca
    `users.subscription_tier`.
  - Un `passId` desconocido responde 400. Nunca cae a un pase por defecto.
  - Exige sesión y las dos autorizaciones obligatorias.
- Referencia única ligada al usuario y al pase:
  `rs_pass_<passId>_<userId>_<ts>_<aleatorio>`.
  - Fila `pending` en `transactions`, con `product = 'resume_pass'` y
    `plan = <passId>` explícito, porque la columna vale `'pro'` por defecto.
  - La firma de integridad sigue la fórmula existente.
- `transactions.product`: columna aditiva `VARCHAR(20) NOT NULL DEFAULT
  'subscription'`, con CHECK `subscription | resume_pass`. Va en el bloque
  `resume-studio` del esquema. **El R5 debe migrarla antes del despliegue.**

### 2. Webhook (los dos productos)

- **H1:** el checksum debe ser hexadecimal de 64 caracteres (se normaliza a
  minúsculas) y se compara con `crypto.timingSafeEqual`. Lo que no cumpla
  responde 401, como hoy.
- **H2 e idempotencia en una sola transacción de base de datos:**
  1. `SELECT … FOR UPDATE` de la fila por referencia.
  2. Si `amount_in_cents` del evento no es igual al guardado, o la moneda
     (si viene) no es `COP`, la fila queda como está: no se aprueba, no
     cambia el tier y no se crea pase. Se registra una advertencia sin
     datos personales.
  3. Si la fila ya está `approved`, no se hace nada.
  4. Si no, se aprueba. Para `resume_pass`, el `rs_entitlements` se crea
     **en la misma transacción**, con `UNIQUE(transaction_reference)`.
- **Respuesta ante un monto alterado:** 200 con `{status:"ignored"}`. Así
  Wompi no reintenta un evento que nunca va a ser válido, y queda el
  registro en el log. Una firma inválida sigue en 401.
- **Ramificación:** primero por `product`.
  - `resume_pass` nunca llega a `upgradeUserToPro`/`upgradeUserToProMax`.
  - `subscription` conserva su comportamiento: `pro_max` →
    `upgradeUserToProMax` y el resto → `upgradeUserToPro`, por 30 días.
- Los estados `DECLINED`, `VOIDED` y `ERROR` pasan a `declined`/`error`
  **solo en filas `resume_pass`** que sigan `pending`, para que la pantalla
  muestre «rechazado». Las suscripciones siguen igual que antes (no-op).
- **Desbloqueo** solo por el webhook verificado o por
  `POST /api/resume/checkout/confirm { transactionId }`.
  - Esa ruta consulta `GET /v1/transactions/{id}` de Wompi. El host es fijo
    y se elige por el prefijo de la llave: `pub_test_` → `sandbox.wompi.co`
    y `pub_prod_` → `production.wompi.co`.
  - Exige que la referencia sea del usuario de la sesión y pasa por la misma
    función de aprobación, con H2 incluido.
  - La URL de retorno solo dice qué transacción consultar. Nunca desbloquea
    nada por sí sola.

### 3. `rs_entitlements` y cupos

- `rs_entitlements`: `id`, `user_id`, `pass_id`, `transaction_reference
  UNIQUE`, `starts_at`, `expires_at`, `adaptations_per_period`,
  `period_days`, `created_at`. RLS activo y `REVOKE` a `anon`/`authenticated`.
- Pases acumulables: uno nuevo empieza cuando vence el último vigente, para
  que el usuario no pierda días.
- `rs_adaptation_quota`: `(bucket, period_start) → used`.
  - `bucket` es el id del pase, o `free:<userId>` para el cupo gratis.
  - Se consume con un `INSERT … ON CONFLICT DO UPDATE … WHERE used < limit
    RETURNING`, que es atómico ante la concurrencia.
- El cupo se consume **solo en `/tailor/start` y solo si la IA está
  encendida**. Las tarjetas no consumen. Sin cupo, la respuesta es 402
  `quota_exhausted`, con un mensaje que lleva al pase. Los topes de costo de
  R3 siguen aplicando encima.
- Cupo gratis sin pase: `RESUME_FREE_ADAPTATIONS = 2` por periodo de 30
  días. **Lo decide el propietario**: ni la tarea ni los docs lo fijan.
- «Borrar todo» y «revocar» no borran `rs_entitlements` ni
  `rs_adaptation_quota`. Son registro de compra y de uso, sin contenido del
  CV. Así el cupo no se reinicia borrando datos.

### 4. Descargas

- **DOCX:** `POST /api/resume/download/docx { facts, templateId }`.
  - Responde 402 `pass_required` sin un pase vigente.
  - Se genera en el servidor sin dependencias nuevas: ZIP almacenado más
    WordprocessingML, con texto escapado.
- **PDF:** imprimir la vista previa. Sin pase vigente se imprime con la marca
  «Vista previa — BuscoTrabajo». Quitarla desde el navegador es el riesgo que
  el doc 06 §6/§10 ya acepta.
- `GET /api/resume/pass` devuelve el catálogo, si los pagos están activos,
  el pase vigente con su cupo y el cupo gratis.

### 5. Pantalla de pase (vista «Pase» del prototipo)

- Tres tarjetas de pase. La de 3 meses se marca «Recomendado» y muestra
  «COP 29.700 en un pago (equivale a COP 9.900/mes)».
- Solo se listan ventajas reales y aplicadas en el servidor: cupo de
  adaptaciones, PDF y DOCX sin marca. No se listan «3 plantillas» (gratis
  desde R1) ni «Mis postulaciones» (R4b, no construido).
- Texto legal: «Precios en COP con IVA incluido. Pago único, sin renovación
  automática. Derecho de retracto según la Ley 1480 (D4, texto final con
  abogado)…». La pantalla no lleva temporizadores, contadores ni cifras de
  personas viendo.
- Con `RESUME_STUDIO_PAYMENTS` apagado, la pantalla dice que los pagos aún
  no están disponibles y no ofrece el botón de pago.

### 6. Pruebas

- **T-PAY-1..5:** aprobado, rechazado, duplicado, monto alterado y firma
  inválida. Usan fixtures de eventos firmados con el secreto sintético del
  runner, en el Postgres desechable, sin dinero real y sin llaves sandbox.
- **Regresión de suscripción:** `pro` y `pro_max` siguen subiendo el tier,
  ahora en el Postgres desechable.
- Unitarias: firma (H1), catálogo y precios, ventanas de cupo, DOCX y
  confirmación por API con `fetch` inyectado.

## Fuera de alcance

- Renovación automática.
- R4b, «Mis postulaciones».
- El precio final (D2) y el texto legal final (D4).
- Reembolsos automáticos.
- Correr `test:paywall` o `test:payment-flow` contra la base del `.env`.

## Gates

`tsc`, `build` (el hash del CSS global no cambia), `test:unit`,
`test:integration`, `test:resume-studio` y T-FREE.
