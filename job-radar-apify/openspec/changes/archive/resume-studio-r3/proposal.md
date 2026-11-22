# Resume Studio R3 — gateway de IA, agente de tarjetas, factualidad y dos puntajes

**Estado:** implementado y archivado (2026-11-21). Evidencia en
[`validation.md`](validation.md).
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../../docs/adr/0017-resume-studio-implementation.md) §2 y §4.
**Rama:** `codex/resume-studio-r3`, cortada de `codex/resume-studio-r2`
(PR #149); PR en borrador contra `codex/resume-studio`. Nada a `main`, nada
en Supabase.
**Guías:** doc 05 (§2 extracción, §4 puntaje, §5 sugerencias), doc 11 §1.1,
§5.2 y §5.4, doc 08 §3, doc 09 §2, §4 y §5, y el prototipo
`docs/resume-studio/mockups/resume-tailor-link-prototype.html`.

## Problema

R1 y R2 dejaron el CV base (a mano o desde un archivo, solo texto) y la
vacante como `JobSnapshot`. Falta el centro del producto: adaptar el CV a la
vacante con un agente de tarjetas, sin inventar datos y con costo de IA
acotado por código.

## Alcance

### 1. Gateway de IA (`src/resume-studio/ai/`)

- Un solo transporte, **compatible con OpenAI**, hacia Alibaba Cloud Model
  Studio, Virginia, alcance «United States»:
  `https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions`.
  `RESUME_AI_WORKSPACE_ID` solo admite `[a-z0-9-]` (no se puede inyectar otro
  host). La llave viene de `RESUME_AI_API_KEY` y nunca se registra.
- `RESUME_AI_PROVIDER = none | mock | qwen` (por defecto `none`). Con `none`
  no se llama a nadie: `/extract` y las tarjetas que necesitan IA responden
  503 `ai_off`. El análisis determinista (requisitos por reglas, puntajes,
  habilidades y mapeo con las palabras del usuario) sigue funcionando.
- **Alias**, nunca nombres de modelo en el código de producto:
  - `fast` → `RESUME_AI_MODEL_FAST`, por defecto `qwen3.7-flash`. Si no
    aparece en la consola us-east-1, el propietario pone `qwen3.8-flash`.
  - `rewrite` → `RESUME_AI_MODEL_REWRITE`, por defecto `qwen3.7-plus`.
- Precios por alias en variables de entorno, con valores por defecto
  tomados de la página oficial de precios (Virginia, «United States»,
  consultada el 2026-11-21): qwen3.7-flash USD 0,03 / 0,13 por millón
  (≤ 32K de entrada) y qwen3.7-plus USD 0,40 / 1,60 (≤ 256K). La TRM sale de
  `RESUME_AI_COP_PER_USD` (por defecto 4.000, supuesta, como el doc 11).
- **Sin modo thinking:** cada solicitud lleva `enable_thinking: false`.
  En la documentación oficial, qwen3.7-flash/plus y qwen3.8-flash traen
  thinking activo por defecto. JSON mode
  (`response_format: {type: "json_object"}`), y cada prompt contiene la
  palabra «JSON», como exige el proveedor.
- **Topes duros en código, antes de cada llamada.** En una transacción con
  `pg_advisory_xact_lock`:
  1. suma del ledger por adaptación, por usuario en el día (America/Bogota),
     global del día y global del mes;
  2. si el **peor caso** de la llamada (tokens de entrada estimados +
     `max_tokens` × precio) supera cualquiera de los cuatro topes, no se llama
     (`budget_exceeded`);
  3. si no, se inserta una fila `reserved` con ese costo. Al terminar, la
     fila pasa a `ok`, `invalid_json` o `error` con el costo real.
  Topes por defecto (env): adaptación USD 0,035 (≈ COP 140, por debajo del
  criterio de COP 150 por construcción); usuario/día USD 0,25; global/día
  USD 5; global/mes USD 60.
- **Ledger `rs_ai_usage` sin contenido.** Columnas: `user_id`,
  `adaptation_id`, `purpose`, `prompt_id`, `prompt_version`, `alias`,
  `model`, tokens de entrada, salida y caché, costo en micro-USD,
  `cache_hit`, `status`, `attempt` y `latency_ms`. Nunca guarda texto del CV,
  de la vacante ni de la respuesta.
- **Caché por hash, solo en memoria.** LRU acotada (500 entradas, 6 h) con
  clave sha256(modelo + prompt + versión + mensajes). **No** va a Postgres:
  guardaría texto derivado del CV en el servidor sin la autorización de
  «guardar en mi cuenta» (R1). Un acierto se registra con costo 0.
- **Reintento:** 1 reintento solo si el JSON llega inválido o no cumple el
  esquema. Cada intento se reserva y se cobra.
- Transporte: `fetch` inyectable, 30 s de timeout, sin redirecciones,
  respuesta ≤ 256 KB. Se ignoran `tool_calls`. El modelo no tiene
  herramientas y nada de su salida se descarga ni se ejecuta.
- **Proveedor `mock`:** determinista y adversarial a propósito. Lee los
  mismos mensajes que recibiría Qwen. En una fracción fija de las propuestas
  inventa cifras, herramientas o empresas, y a veces devuelve JSON inválido.
  Así las evals prueban que el validador y el reintento funcionan.

### 2. Extracción del CV a JSON con `source_span` verificado

- Prompt `cv_extract@1` (alias `fast`). El modelo devuelve los hechos del
  esquema R1 y, por cada campo, una **cita literal** (`quote`).
- El código busca cada cita en el texto original, normalizando espacios,
  mayúsculas y tildes, y calcula `sourceSpan {start, end}`. Si la cita no
  aparece, el campo se descarta y pasa a la lista de preguntas. Las fechas
  ilegibles quedan vacías: nunca se completan.
- Datos sensibles (cédula, estado civil, edad, EPS, religión, etc.) se
  detectan por patrón y no van al modelo ni al resultado.
- El esquema R1 amplía `source` de forma aditiva: `"user" | "file"` (por
  defecto `"user"`). Los datos guardados en R1 siguen siendo válidos.
- La extracción **no guarda nada**: devuelve los hechos para que el usuario
  los revise en el editor.

### 3. Máquina de estados de tarjetas (doc 11 §5.2)

La cola la decide el **código**, en este orden:
`headline → skills → requirement_mapping ×N (máx. 5) → summary`.

- **S1 requisitos:** primero por reglas (encabezados «Requisitos», «Deseable»,
  viñetas y palabras como «indispensable» o «deseable»). Solo si no sale
  nada, `job_requirements@1` (`fast`), y cada requisito debe aparecer
  literalmente en la vacante.
- **S2 evidencia:** `evidence_map@1` (`fast`) propone, por requisito, citas
  `{factId, quote}`. El código comprueba que el hecho existe y que la cita
  está en su texto. El nivel (demostrado / parcial / no) lo calcula el
  **código**, por cobertura de términos del requisito en los hechos citados.
  Sin IA, se usa solo la cobertura por términos.
- **S3:** puntaje inicial (§4).
- **S5, una llamada por tarjeta** con esquema JSON estricto, más 1
  reintento si el JSON llega inválido:
  - `headline`: `card_headline@1` (`fast`).
  - `skills`: sin LLM. Habilidades de la vacante que faltan, con casillas
    una por una y **sin «Añadir todo»**. El servidor solo acepta un
    subconjunto de las que ofreció.
  - `requirement_mapping` N/M: «¿Dónde demostraste *{requisito}*?» con las
    experiencias, más «En ninguna» y «Lo hice en otro lugar». Con la
    respuesta del usuario, `card_rewrite@1` (`rewrite`) redacta la viñeta.
  - `summary`: `card_summary@1` (`fast`), solo con hechos aprobados.
- **Validador de factualidad (código):** cifras, porcentajes, fechas/años,
  herramientas (catálogo de `extract-technologies` + catálogo de
  habilidades del Studio), nombres propios y cargos del texto propuesto
  deben estar en los hechos citados o en la respuesta del usuario. Un
  `supporting_fact_id` desconocido rechaza la propuesta. Si hay un dato
  nuevo: si es una habilidad o herramienta, la tarjeta se convierte en
  **pregunta** («¿Usaste X?»); si no, se **descarta** y se muestra el texto
  original.
- **Chat libre** (`card_chat@1`, `fast`): solo modifica la propuesta de la
  tarjeta activa, pasa por el mismo validador y tiene un tope de **8
  turnos** por adaptación, contados en el ledger.
- **Estado en el cliente, topes en el servidor.** La adaptación vive en el
  navegador: el CV adaptado no se guarda sin la autorización de
  almacenamiento. El servidor emite el `adaptationId` (fila `start` en el
  ledger, ligada al usuario). Toda llamada posterior exige que ese id sea
  del usuario (si no, 404) y aplica los topes y el conteo de turnos.

### 4. Dos puntajes deterministas (`src/lib/resume-tailor/score.ts`)

Módulo puro, compartido por el servidor y la página, así que la cifra se
recalcula sin llamar al modelo.

- **Compatibilidad estimada** (doc 05 §4): obligatorios 40, deseables 15,
  habilidades de la vacante 20, legibilidad 15 (5 comprobaciones × 3),
  resumen enfocado 10. Si no hay obligatorios o deseables, el peso se
  redistribuye y se avisa en pantalla. Debajo, el texto fijo: «Estimación de
  BuscoTrabajo con una fórmula pública. No es el puntaje de ningún ATS y no
  garantiza entrevistas.»
- **Calidad de tu hoja de vida** (0–100, solo estructura): contacto,
  resumen de 2–4 líneas, viñetas que empiezan con verbo, fechas completas y
  coherentes, de 2 a 6 viñetas por experiencia, habilidades, formación,
  largo razonable y viñetas con resultados medibles. Nunca se llama
  «ATS».
- Variables prohibidas (edad, sexo, foto, estado civil, nacionalidad,
  dirección, etnia, religión, discapacidad, salud, afiliación) no entran en
  el cálculo ni llegan al modelo.

### 5. UI del agente en `/hoja-de-vida`

Sigue el prototipo: anillo de compatibilidad, cola de tarjetas «N de M»
con Aplicar / Editar / Omitir y diff en verde, casillas de habilidades sin
«Añadir todo», composer limitado a la tarjeta activa, vista previa del CV
y, en móvil, pestañas «Agente / Tu hoja de vida». Al terminar, «Usar esta
versión» la lleva al editor, sin tocar la base guardada hasta que el
usuario guarde. Sigue en el chunk perezoso, y el CSS global no cambia ni
un byte.

### 6. Prompts versionados (`src/resume-studio/ai/prompts.ts`)

Cada prompt tiene `id@version`, alias, presupuesto de entrada y salida
(`max_tokens`), esquema Zod estricto y texto de sistema que declara la
vacante y el CV como **datos**. Los datos van entre delimitadores
`<<<VACANTE>>>…<<<FIN_VACANTE>>>` y `<<<CV>>>…<<<FIN_CV>>>`, y cualquier
`<<<`/`>>>` dentro de ellos se neutraliza. Al modelo no llegan nombre,
correo, teléfono, enlaces ni ciudad del usuario.

## Evals (doc 09 §4)

`scripts/eval-resume-tailor.ts` y la prueba unitaria
`validate-resume-studio-evals.test.ts`: **20 CV sintéticos × 10 vacantes**
(incluida una con inyección) con el proveedor `mock` adversarial.

- **Criterio:** 0 hechos inventados aceptados.
- Costo por adaptación = tokens del ledger × precios configurados, reportado
  contra **COP 150**. Lo que mide el `mock` son tokens estimados.
- **La corrida contra Qwen real** necesita la aprobación explícita del
  propietario y su llave. No se corre en esta sesión.

## Gates

`npx tsc --noEmit`, `npm run build` (hash del CSS sin cambios; IA fuera del
bundle principal), `npm run test:unit` (JPD-001 heredado aparte),
`npm run test:integration`, T-INJ y T-FREE. Todo detrás de
`RESUME_STUDIO_ENABLED=false` y `RESUME_AI_PROVIDER=none` por defecto.

## Fuera de alcance

Pagos y cupos (R4), «Mis postulaciones» (R4b), descarga PDF/DOCX final,
cifrado de `facts_json` en la aplicación (antes de R5), verificador LLM
opcional del doc 05 §5, y cualquier cambio en Supabase o `main`.

## Decisiones abiertas para el propietario

- Confirmar en la consola us-east-1 si existe `qwen3.7-flash`. Si no,
  `RESUME_AI_MODEL_FAST=qwen3.8-flash` (USD 0,15 / 0,47).
- Aprobar y dar la llave para la única corrida real de evals.
- Al «borrar todo» o revocar, las filas del ledger quedan sin `user_id` (los
  costos siguen contando para los topes globales). Por eso el tope por
  usuario se reinicia tras un borrado. Lo acotan el tope global y el límite
  de frecuencia.
- Topes por defecto (USD 0,035 por adaptación, 0,25 por usuario al día, 5
  global al día y 60 al mes).
