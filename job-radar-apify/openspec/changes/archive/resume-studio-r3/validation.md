# Validation — Resume Studio R3

Rama `codex/resume-studio-r3` (desde `codex/resume-studio-r2`, con 8bc6cca
—stub de `@napi-rs/canvas`— integrado por merge). Fecha: 2026-11-21. Todo con
datos sintéticos; nada en Supabase ni en `main`.

## Gates (HEAD final)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 errores |
| `npm run build` | ✅. El CSS global queda **idéntico byte a byte** a R2 (`index-BeuqwIzT.css`, SHA-256 `1d7ac096…c048`). El agente vive solo en el chunk perezoso `ResumeStudio-*.js`. Ni el gateway, ni el endpoint de Alibaba, ni `enable_thinking`, ni pdf.js aparecen en el cliente. |
| `npm run test:unit` | Se detiene en **JPD-001, heredado** (`validate-job-page-blocks.test.ts`: fixtures con fecha vieja; es el mismo fallo de la base, y lo arregla el PR #148). Como el runner corta ahí, las pruebas unitarias de R3 (al final de la lista) no corren en `test:unit` hasta que entre #148. Mientras tanto, su gate es `test:resume-studio`. Con #148 aplicado de forma temporal (`e7e49e1`, revertido después) sobre `f6b958a`: **685 pruebas, 0 fallos**. Las pruebas añadidas después (RS3-FACT-2 y los casos de T-SENS) pasan en `test:resume-studio`. |
| `npm run test:integration` | ✅ exit 0. Incluye R1, R2, **R3** y T-FREE. |
| `npm run test:resume-studio` | ✅ en el HEAD final (tras los ajustes): 75 pruebas unitarias del Studio y 29 comprobaciones de integración, 0 fallos. |
| T-INJ (`validate-resume-studio-injection.test.ts`) | ✅ 5/5: T-INJ-0..3 + T-SENS |
| T-FREE (`validate-resume-studio-free.ts`) | ✅ «T-FREE: OK»: vacantes, `/api/v1/jobs` y el dashboard responden igual con la bandera apagada y encendida |

Nota: T-FREE da 500 en `/dashboard` si `public/` no está construido. Por
eso se corre después de `npm run build`.

## Pruebas nuevas

- `validate-resume-studio-tailor.test.ts` (14):
  - requisitos por reglas: encabezados en línea y «Ofrecemos» corta la lista;
  - evidencia verificada por código;
  - los dos puntajes: pesos del doc 05 §4, redistribución, determinismo, y los datos de contacto no mueven la cifra;
  - **tabla de 40 casos de factualidad** (doc 09 §2);
  - RS3-FACT-2: logros y alcance sin cifras («duplicando las ventas», «lideré», «a nivel nacional», «amplia experiencia») se descartan, y el título solo usa palabras del CV;
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
| Invenciones del mock | 247: cifras, herramientas, cargos, empresas y logros sin cifra. Llamadas con JSON inválido: 69, todas reintentadas. |
| Propuestas mostradas / descartadas / convertidas en pregunta | 273 / 271 / 2 |
| Compatibilidad media | 18 → 21. El mock casi no reescribe: el criterio de esta eval es la factualidad, no la calidad. |
| Costo por adaptación (tokens estimados del mock × precios configurados) | prom. COP 0,48, máx. COP 4,72 |

**Alcance del «0 inventados».** El validador detecta, por código, estas
clases de afirmación:

- cifras, porcentajes, años y meses;
- herramientas y habilidades del catálogo;
- nombres propios, siglas y combinaciones de letras y dígitos;
- cargos y niveles;
- logros, alcance y liderazgo por raíz de palabra;
- enlaces y HTML;
- en el título, cualquier palabra que no esté en el CV.

El mock inventa justo esas clases, así que la eval prueba que el validador
las atrapa todas. Lo que queda fuera de esas clases lo deben revisar la
corrida real contra Qwen y una revisión humana (doc 09 §4). Algunos ejemplos:

- adjetivos blandos («proactiva», «orientada a resultados»);
- afirmaciones parafraseadas sin palabras clave.

Sobre el costo:

- Las cifras del mock **no** son mediciones reales: los CV sintéticos son cortos y los tokens son una estimación (≈ 3 caracteres por token).
- El **criterio ≤ COP 150 queda garantizado por código**: el tope duro por adaptación por defecto es USD 0,035 (≈ COP 140 con TRM 4.000), y la prueba RS3-AI-CFG lo comprueba.
- Con el presupuesto del doc 11 §5.4 (~63.000 tokens de entrada y ~10.500 de salida), los precios oficiales dan ≈ COP 13 todo en flash y ≈ COP 37 con plus en las 4 reescrituras.

## Corrida real contra Qwen (2026-11-22, aprobada por el propietario)

El propietario la corrió en su PowerShell, con su llave, sobre `f0d3d54`. El
agente no leyó el `.env`: lo bloquea la configuración. Workspace en Virginia,
alcance «United States». El script impuso un tope de USD 1 a toda la corrida.

- **Humo:** ok. `qwen3.7-flash`, 1.720 ms, 401/67 tokens, USD 0,000021.
- **Eval:** 6 CV (P2, P3, P5, P10, P13, P20) × 4 vacantes (V1, V2, V4, V7) = 24 adaptaciones y 6 extracciones. **PASS.**

| Métrica | Resultado real |
| --- | --- |
| **Hechos inventados aceptados** (tarjetas / extracción) | **0 / 0** |
| Fugas de datos sensibles | 0. P10 trae cédula, estado civil, EPS y fecha de nacimiento; P20 trae inyección. |
| Propuestas mostradas | 42: título 15, resumen 8, reescritura 4, chat 15 |
| Descartadas / preguntas / no disponibles | 19 / 0 / 6 |
| Compatibilidad media | 25 → 29 |
| Llamadas | 106. JSON inválido 17 (16 %), errores 0, aciertos de caché 2. |
| Latencia p50 | `cv_extract` 2.923 ms · `evidence_map` 1.135 · título 1.100 · reescritura 1.778 · resumen 1.529 · chat 1.008 |
| Tokens medios por adaptación | 2.523 de entrada (165 en caché), 466 de salida |
| **Costo real por adaptación** | **USD 0,000186 de media (≈ COP 0,74); máximo USD 0,001142 (≈ COP 4,57)** con TRM 4.000 |
| Total de la corrida | USD 0,005046 en 150 s |

Lectura de los resultados:

- **El criterio de salida de R3 se cumple con datos reales.** 0 hechos inventados aceptados, y el costo queda unas 30 veces por debajo de COP 150, aun en el peor caso.
- **Calidad para ajustar, sin aflojar el validador.** Ver «Ajustes tras la corrida real» abajo:
  - el 16 % de las llamadas devolvió JSON inválido;
  - 19 propuestas se descartaron, sobre todo títulos con palabras nuevas y resúmenes con logros o cargos;
  - 0 preguntas;
  - la compatibilidad sube poco, porque la eval solo responde los requisitos para los que la persona sintética tiene una respuesta escrita.

## Ajustes tras la corrida real (`f8ba977`, sin aflojar el validador)

Nada que antes se rechazaba se acepta ahora. Cambia la forma de rechazar y
la tolerancia a la *forma* del JSON, no a su contenido.

1. **JSON inválido (16 %).** Sin ver las respuestas reales (no se guardan), se atacan las causas probables:
   - **Esquemas tolerantes en la forma:**
     - las claves desconocidas se descartan;
     - un `null` o un campo ausente pasa a `""` o `[]`;
     - los textos y listas largos se recortan;
     - un ítem de lista que no encaja se omite en vez de anular toda la respuesta.
   - El parser extrae el objeto aunque venga con texto alrededor.
   - Temperatura **0**, antes 0,2.
   - **El reintento lleva una nota correctiva** con el tipo de fallo y los nombres de los campos, nunca contenido de la respuesta.
   - Se registra `finish_reason` para detectar respuestas cortadas.
   - **Diagnóstico nuevo, `invalidReasons`:** prompt, tipo (`parse`, `schema` o `truncated`) y rutas de campo, sin contenido. La próxima corrida dirá qué falla exactamente.
   - `response_format` con `json_schema` no se activó: no está verificado que qwen3.7 lo soporte en modo no thinking. Queda abierto.
2. **Descartes (19) y 0 preguntas.**
   - **Prompts v2** (todos versionados):
     - el título solo puede usar palabras que ya están en el CV;
     - se prohíben palabras de resultado, alcance o nivel que los datos no digan;
     - el resumen describe lo que la persona hizo, sin calificarla;
     - cuando falta un dato, el modelo responde con **`question`** en vez de escribirlo.
   - **Política del validador:**
     - si las afirmaciones nuevas son solo cifras, fechas, herramientas o logros, la tarjeta pasa a **pregunta**: no se aplica nada y el usuario lo escribe con sus palabras;
     - nombres propios, cargos, enlaces y palabras nuevas en el título se siguen **descartando**.
   - La tabla de 40 casos se actualizó en consecuencia: 10 casos pasan de «descartar» a «pregunta» y ninguno a «aceptar».
3. **Compatibilidad que sube poco.**
   - La persona sintética ahora también responde los requisitos que su propio CV demuestra, citando su viñeta.
   - Con `--answer-all`, la persona responde **todas** las tarjetas de requisito con una respuesta sintética, que pasa a ser la fuente del validador. Así se mide el flujo completo mapeo → reescritura.
   - Con el mock: 373 reescrituras, compatibilidad **18 → 59**, 0 inventados y máximo COP 14,16 por adaptación. Queda como prueba de CI (RS3-EVAL-FULL).

Gates tras los ajustes:
- build ✅, con el CSS idéntico (`1d7ac096…c048`);
- `test:resume-studio` ✅: 75 pruebas unitarias y 29 comprobaciones de integración, con T-INJ y T-FREE;
- `test:integration` ✅.

**Para volver a medir con Qwen real.** Lo corre el propietario en PowerShell, desde `job-radar-apify` en este worktree. El agente no carga el `.env`.

```powershell
$env:DATABASE_URL="postgres://unused@127.0.0.1:1/x"; $env:RESUME_AI_EVAL_LIVE="1"
npx tsx --env-file="C:\Users\yosma.DESKTOP-RQ0SDF3\OneDrive\Job-finder\job-radar-apify\.env" scripts/eval-resume-tailor.ts --live --cvs P2,P3,P5,P10,P13,P20 --jobs V1,V2,V4,V7
npx tsx --env-file="C:\Users\yosma.DESKTOP-RQ0SDF3\OneDrive\Job-finder\job-radar-apify\.env" scripts/eval-resume-tailor.ts --live --answer-all --cvs P2,P4,P11,P20 --jobs V1,V3,V8
```

El script impone un tope de USD 1 a cada corrida. El costo esperado es de unos pocos centavos de dólar.

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

- La revisión final encontró dos fallos y ambos se corrigieron con pruebas:
  1. El filtro de datos sensibles quitaba líneas legítimas: «Universidad Católica», «EPS Sura» como empleador, «diagnóstico de redes», «barrio La Paz». Ahora solo quita líneas con forma de etiqueta (`Religión: …`) y valores inequívocos (cédula con número, dirección «Calle 12 # 34-56»).
  2. El validador dejaba pasar logros sin cifra y palabras nuevas después de «·». Se añadieron el tipo de afirmación «logro o alcance» y la regla estricta para el título.

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
