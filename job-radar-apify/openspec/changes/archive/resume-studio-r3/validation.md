# Validation — Resume Studio R3

Rama `codex/resume-studio-r3` (desde `codex/resume-studio-r2`, con 8bc6cca
—stub de `@napi-rs/canvas`— integrado por merge). Fecha: 2026-11-21. Todo con
datos sintéticos; nada en Supabase ni en `main`.

## Gates (HEAD final)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 errores |
| `npm run build` | ✅. El CSS global queda **idéntico byte a byte** a R2 (`index-BeuqwIzT.css`, SHA-256 `1d7ac096…c048`). El agente vive solo en el chunk perezoso `ResumeStudio-*.js`. Ni el gateway, ni el endpoint de Alibaba, ni `enable_thinking`, ni pdf.js aparecen en el cliente. |
| `npm run test:unit` | Se detiene en **JPD-001, heredado** (`validate-job-page-blocks.test.ts`: fixtures con fecha vieja; es el mismo fallo de la base, y lo arregla el PR #148). Con el commit de #148 aplicado de forma temporal (`e7e49e1`, revertido después): **685 pruebas, 0 fallos**. |
| `npm run test:integration` | ✅ exit 0. Incluye R1, R2, **R3** y T-FREE. |
| `npm run test:resume-studio` | ✅ 72 pruebas unitarias del Studio y 29 comprobaciones de integración, 0 fallos. |
| T-INJ (`validate-resume-studio-injection.test.ts`) | ✅ 5/5: T-INJ-0..3 + T-SENS |
| T-FREE (`validate-resume-studio-free.ts`) | ✅ «T-FREE: OK»: vacantes, `/api/v1/jobs` y el dashboard responden igual con la bandera apagada y encendida |

Nota: T-FREE da 500 en `/dashboard` si `public/` no está construido. Por
eso se corre después de `npm run build`.

## Pruebas nuevas

- `validate-resume-studio-tailor.test.ts` (13):
  - requisitos por reglas: encabezados en línea y «Ofrecemos» corta la lista;
  - evidencia verificada por código;
  - los dos puntajes: pesos del doc 05 §4, redistribución, determinismo, y los datos de contacto no mueven la cifra;
  - **tabla de 40 casos de factualidad** (doc 09 §2);
  - cola de tarjetas: orden fijo, máximo 5 mapeos, sin «añadir todo» ni siquiera desde fuera;
  - esquema `source` aditivo.
- `validate-resume-studio-ai.test.ts` (10):
  - config: falla cerrada, sin inyección de host, precios, y tope por adaptación ≤ COP 150;
  - cuerpo de Qwen: `enable_thinking:false`, JSON mode, sin `tools`, `redirect:error` y tope de 256 KB;
  - el error no repite el cuerpo de la respuesta;
  - `none` no llama nada;
  - 1 reintento y nunca 3;
  - caché en memoria con costo 0;
  - los 4 topes bloquean **antes** de la llamada;
  - 8 turnos de chat;
  - ledger sin contenido;
  - ventanas de día y mes de Colombia.
- `validate-resume-studio-injection.test.ts` (5): ver T-INJ.
- `validate-resume-studio-evals.test.ts` (1): evals 20 × 10 en CI.
- `validate-resume-studio-r3.ts` (integración, 8 bloques):
  - `rs_ai_usage` tiene RLS, 0 permisos públicos y ninguna columna de contenido;
  - con **30 reservas concurrentes, pasan exactamente 10** (advisory lock);
  - T-ANON y autorización en `/extract` y `/tailor/*`;
  - `source_span` verificado contra el texto original;
  - IDOR del `adaptationId` → 404;
  - tope de 8 turnos → 429;
  - «500 millones» se descarta;
  - **T-LOG**: 0 datos del CV en los logs;
  - con `none`: 503 y 0 llamadas;
  - **T-DEL**: borrar todo y revocar dejan el ledger sin `user_id`.

## Evals (`npx tsx scripts/eval-resume-tailor.ts`, proveedor `mock` adversarial)

20 CV sintéticos × 10 vacantes = 200 adaptaciones + 20 extracciones. Una
vacante (V4) y un CV (P20) traen inyección; un CV (P10) trae datos sensibles.

| Métrica | Resultado |
| --- | --- |
| **Hechos inventados aceptados** (tarjetas) | **0**. Lo verifican dos controles independientes: marcadores que el mock inventa a propósito y reglas sobre el CV original más las respuestas de la persona. |
| Hechos inventados aceptados (extracción) | **0** |
| Fugas de datos sensibles | 0 |
| Invenciones del mock | 232. Llamadas con JSON inválido: 58, todas reintentadas. |
| Propuestas mostradas / descartadas / convertidas en pregunta | 276 / 276 / 2 |
| Compatibilidad media | 18 → 21. El mock casi no reescribe: el criterio de esta eval es la factualidad, no la calidad. |
| Costo por adaptación (tokens estimados del mock × precios configurados) | prom. COP 0,48, máx. COP 4,75 |

Sobre el costo:

- Las cifras del mock **no** son mediciones reales: los CV sintéticos son cortos y los tokens son una estimación (≈ 3 caracteres por token).
- El **criterio ≤ COP 150 queda garantizado por código**: el tope duro por adaptación por defecto es USD 0,035 (≈ COP 140 con TRM 4.000), y la prueba RS3-AI-CFG lo comprueba.
- Con el presupuesto del doc 11 §5.4 (~63.000 tokens de entrada y ~10.500 de salida), los precios oficiales dan ≈ COP 13 todo en flash y ≈ COP 37 con plus en las 4 reescrituras.

**Pendiente con aprobación del propietario:** una sola corrida real contra
Qwen para medir costo y calidad:

```
RESUME_AI_EVAL_LIVE=1 RESUME_AI_PROVIDER=qwen RESUME_AI_WORKSPACE_ID=… RESUME_AI_API_KEY=… npx tsx scripts/eval-resume-tailor.ts --live
```

No se corrió en R3: requiere su llave y su aprobación explícita.

## Revisión visual

Se usó un arnés temporal de Vite con respuestas simuladas; no se subió.

- **Escritorio (1280 px):**
  - aparecen el anillo, el desglose y la tarjeta de título con el diff;
  - las casillas de habilidades se marcan una por una;
  - el mapeo lleva a una viñeta nueva;
  - el chat «agrega que vendí 500 millones» se rechaza y lo explica;
  - la cifra sube de 19 a 37.
- **Móvil (375 px):** las pestañas «Agente / Tu hoja de vida» funcionan, sin scroll horizontal.
- **Pendiente para el propietario:** revisarlo con sesión real en `/hoja-de-vida` (requiere `RESUME_STUDIO_ENABLED=true` y una sesión de Supabase).

## Hallazgos durante la fase

- La variable `!block` del mock generaba la clase Tailwind `.!block`. Tailwind escanea también el código del servidor. Se renombró y el CSS volvió a ser idéntico.
- Las líneas de un CV o de una vacante dirigidas a la IA («ignora las instrucciones…») ahora:
  - se quitan antes del modelo y se avisan como «texto dirigido a la IA»;
  - no cuentan como requisito (`suspiciousLines`).
- El tope por adaptación propuesto (USD 0,05 ≈ COP 200) superaba el criterio. Bajó a USD 0,035.

## Decisiones abiertas (propietario)

- Confirmar en la consola us-east-1 si existe `qwen3.7-flash`. Si no, usar `RESUME_AI_MODEL_FAST=qwen3.8-flash` (USD 0,15 / 0,47; se toma el precio solo). El 2026-11-21, la página oficial de precios listaba ambos en Virginia, «United States».
- Aprobar y dar la llave para la corrida real de evals.
- Ledger tras «borrar todo» o revocar: queda sin `user_id`, y el tope por usuario se reinicia. Lo acotan el tope global y el límite de frecuencia.
- Valores de los topes por defecto (USD 0,035 / 0,25 / 5 / 60).
