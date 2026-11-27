# Investigación: precios LLM, manejo de datos, competidores, pagos y marco legal (Colombia)

Fecha de consulta de TODAS las fuentes: **2026-11-14** (salvo que se indique otra).
Método: WebFetch/WebSearch sobre páginas oficiales. Las cifras se transcriben tal como
las devolvió la página ese día. "No verificado" = no se pudo confirmar en fuente oficial.
Advertencia: WebFetch resume páginas largas con un modelo; para decisiones de dinero o
legales, reabrir la URL y confirmar la cifra exacta.

---

## A) Precios de API (USD por 1M tokens)

### A.1 Google Gemini API (AI Studio / Developer API)
Fuente: https://aistudio.google.com/docs/pricing (redirige desde ai.google.dev/gemini-api/docs/pricing), visto 2026-11-14.

| Modelo | Input (texto) | Output (incl. thinking) | Context caching | Free tier |
|---|---|---|---|---|
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.01 | Sí |
| Gemini 2.5 Flash | $0.30 | $2.50 | $0.03 | Sí (DEPRECADO: desde 2026-12-01 sus requests se enrutan a 3.5 Flash-Lite y se cobran a ese precio) |
| Gemini 3 Flash Preview | $0.50 | $3.00 | $0.05 | Sí |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | $0.025 | Sí |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | $0.03 | Sí |
| Gemini 3.6 Flash | $0.75 hasta 2026-12-31 ($1.50 desde 2027-01-01) | $3.75 ($7.50) | $0.075 ($0.15) | Sí |
| Gemini 3.8 Flash | $0.75 hasta 2026-12-31 ($1.50 desde 2027-01-01) | $3.75 ($7.50) | $0.075 ($0.15) | Sí |

- Fila "Used to improve our products": **Free = Yes / Paid = No** para todos los modelos anteriores (misma URL).
- Almacenamiento de caché: $1.00 por 1M tokens/hora (2.5 Flash-Lite, 2.5 Flash, 3 Flash Preview, 3.x Flash-Lite); $0.50/h para 3.6/3.8 Flash ($1.00 desde 2027).
- Límites del free tier (RPM/TPM/RPD): la página https://aistudio.google.com/docs/rate-limits dice que se consultan en Google AI Studio; **cifras por modelo no verificadas**. Límites por proyecto, RPD se reinicia a medianoche hora Pacífico.

### A.2 DeepSeek
Fuente: https://api-docs.deepseek.com/quick_start/pricing, visto 2026-11-14.

| Modelo (alias) | Versión | Input cache hit | Input cache miss | Output | Contexto |
|---|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | $0.003 off-peak / $0.006 peak | $0.15 / $0.30 | $0.60 / $1.20 | 1M |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | $0.022 / $0.044 | $0.66 / $1.32 | $1.98 / $3.96 | 1M |

- Off-peak = mitad del precio peak. Peak: 01:00–04:00 y 06:00–10:00 UTC, lunes a viernes (excepto festivos chinos).
- Nombres legacy `deepseek-v4-flash` siguen aceptados y se cobran a precio Flash.
- Ya no aparecen "deepseek-chat / V3.x" en la página: **V3.x no listado** (no verificado si sigue disponible).

### A.3 Qwen — Alibaba Cloud Model Studio, despliegue Internacional (Singapur)
Fuente: https://www.alibabacloud.com/help/en/model-studio/model-pricing, visto 2026-11-14.

| Modelo | Tramo de input por request | Input | Output | Cuota gratis |
|---|---|---|---|---|
| qwen3.8-flash (más nuevo) | ≤1M | $0.15 | $0.47 | 1M tokens |
| qwen3.7-flash | 0–32K | $0.03 | $0.13 | 1M tokens |
| | 32K–256K | $0.10 | $0.40 | |
| | 256K–1M | $0.20 | $0.80 | |
| qwen3.6-flash | 0–256K | $0.25 | $1.50 | No |
| qwen3.5-flash | ≤1M | $0.10 | $0.40 | No |
| qwen-flash (2025-07-28) | 0–256K | $0.05 | $0.40 | No |
| | 256K–1M | $0.25 | $2.00 | |
| qwen3.7-plus | 0–256K | $0.40 (20% dto. temporal) | $1.60 | 1M tokens |
| qwen-plus (2025-12-01) | 0–256K | $0.40 | $1.20 (no-thinking) / $4.00 (thinking) | No |
| qwen3.5-plus | 0–256K | $0.40 | $2.40 | No |

- Cuota gratis: válida 90 días desde activación / lanzamiento del modelo; solo región Singapur.
- **qwen-turbo: no aparece en la parte leída de la página → no verificado.**
- Nota: el tramo 0–32K de qwen3.7-flash ($0.03/$0.13) es el precio más bajo encontrado para un modelo de pago con proveedor "grande" (pero ver sección B: datos en Singapur/global).

### A.4 GLM — Z.ai (Zhipu internacional)
Fuente: https://docs.z.ai/guides/overview/pricing, visto 2026-11-14.

| Modelo | Input | Cached input | Output |
|---|---|---|---|
| GLM-4.6 | $0.60 | $0.11 | $2.20 |
| GLM-4.5-Air | $0.20 | $0.03 | $1.10 |
| GLM-4.5-Flash | Gratis | Gratis | Gratis |
| GLM-4.7-Flash | Gratis | Gratis | Gratis |
| GLM-4.6V-Flash | Gratis | Gratis | Gratis |

- Límites de rate de los modelos gratis: **no verificado**.

### A.5 Kimi — Moonshot AI (ahora platform.kimi.ai)
Fuente: https://platform.kimi.ai/docs/pricing/chat (redirige desde platform.moonshot.ai), visto 2026-11-14.
- **Precios por token: no verificados** (las tablas se renderizan con JS y no llegaron en el fetch).
- Dato relevante: K2 deja de estar disponible para usuarios nuevos desde **2026-10-31** y todos los K2 se retiran a fines de **diciembre 2026**. Serie actual: K3 (`kimi-k3.1-pro`, `kimi-k3`), contexto 1,048,576 tokens; batch al 60% del precio estándar.
- Conclusión práctica: Kimi K2 no es opción para un producto nuevo.

### A.6 OpenAI
Fuente: https://developers.openai.com/api/docs/pricing (redirige desde platform.openai.com/docs/pricing), visto 2026-11-14. Tier Standard.

| Modelo | Input | Cached input | Output |
|---|---|---|---|
| gpt-5-nano | $0.05 | $0.005 | $0.40 |
| gpt-5-mini | $0.25 | $0.025 | $2.00 |
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 |
| gpt-4.1-nano | **no listado en la página → no verificado** | | |

- Ojo: modelos de razonamiento (gpt-5-*) cobran tokens de razonamiento como output; el costo real por CV puede ser mayor que el cálculo ingenuo.

### A.7 Anthropic Claude Haiku
Fuente: https://platform.claude.com/docs/en/about-claude/pricing, visto 2026-11-14.

| Modelo | Input | Cache write 5m | Cache write 1h | Cache hit | Output |
|---|---|---|---|---|---|
| Claude Haiku 5.5 (prompts ≤100K tokens) | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
| Claude Haiku 5.5 (prompts >100K) | $0.50 | $0.625 | $1.00 | $0.05 | $2.50 |
| Claude Haiku 4.5 | $1.00 | $1.25 | $2.00 | $0.10 | $5.00 |

- Batch (50%): Haiku 5.5 ≤100K = $0.05 input / $0.25 output; Haiku 4.5 = $0.50 / $2.50.
- Inferencia solo-EE. UU. (`inference_geo`) = multiplicador 1.1x; enrutamiento global (por defecto) a precio estándar.

### A.8 Modelos abiertos hospedados

**Groq** — fuente: https://console.groq.com/docs/models, visto 2026-11-14 (groq.com/pricing no mostró cifras).
| Modelo | Input | Output |
|---|---|---|
| openai/gpt-oss-20b | $0.075 | $0.30 |
| openai/gpt-oss-120b | $0.15 | $0.60 |
| qwen/qwen3.8-27b (preview) | $0.80 | $4.00 |
- llama-3.1-8b-instant y llama-3.3-70b-versatile: listados como Enterprise "Contact Sales" → precio **no verificado**. Qwen3-32B / Kimi K2: no listados en producción.

**Together AI** — fuente: https://www.together.ai/pricing, visto 2026-11-14 (serverless).
| Modelo | Input | Output |
|---|---|---|
| gpt-oss-120B | $0.15 | $0.60 |
| Qwen3.8 Flash | $0.15 | $0.47 |
| Qwen3.5 9B | $0.17 | $0.25 |
| Qwen2.5 7B Instruct Turbo | $0.30 | $0.30 |
- gpt-oss-20b, Llama 3.1 8B, Llama 3.3 70B serverless: **no listados → no verificado**.

**OpenRouter** — fuente: https://openrouter.ai/docs/faq, visto 2026-11-14.
- Sin markup sobre el precio del proveedor; comisión al comprar créditos **5.5% (mínimo $0.80)**, cripto 5%.
- Modelos `:free`: 50 requests/día; 1,000/día si se han comprado ≥10 créditos.

**Cloudflare Workers AI** — fuente: https://developers.cloudflare.com/workers-ai/platform/pricing/, visto 2026-11-14.
- **$0.011 por 1,000 neurons**; **10,000 neurons/día gratis** en Workers Free y Workers Paid (reinicio 00:00 UTC).

| Modelo | Input | Output |
|---|---|---|
| @cf/meta/llama-3.1-8b-instruct-fp8-fast | $0.045 | $0.384 |
| @cf/meta/llama-3.1-8b-instruct-awq | $0.123 | $0.266 |
| @cf/meta/llama-3.1-8b-instruct | $0.282 | $0.827 |
| @cf/meta/llama-3.3-70b-instruct-fp8-fast | $0.293 | $2.253 |
| @cf/openai/gpt-oss-20b | $0.200 | $0.300 |
| @cf/openai/gpt-oss-120b | $0.350 | $0.750 |
| @cf/qwen/qwen3-30b-a3b-fp8 | $0.051 | $0.335 |
| @cf/qwen/qwen3.8-27b | $0.450 | $3.200 |

### A.9 Costo estimado por CV (cálculo propio, no fuente)
Supuesto: 1 generación = 5,000 tokens input + 2,000 tokens output (sin razonamiento extra).
| Opción | Costo USD por CV |
|---|---|
| gpt-5-nano | 0.00025 + 0.0008 = **$0.00105** (+ tokens de razonamiento) |
| Gemini 2.5 Flash-Lite (pago) | 0.0005 + 0.0008 = **$0.0013** |
| Claude Haiku 5.5 | 0.0005 + 0.001 = **$0.0015** |
| qwen3.7-flash (0–32K) | 0.00015 + 0.00026 = **$0.00041** |
| deepseek-flash (peak) | 0.0015 + 0.0024 = **$0.0039** |
| Gemini 3.1 Flash-Lite | 0.00125 + 0.003 = **$0.00425** |
Con 3–5 llamadas por CV todos quedan muy por debajo de USD 0.03, es decir, < ~COP 150 a cualquier tasa razonable. El costo LLM es despreciable frente a la comisión de pasarela (sección D).

---

## B) Manejo de datos en API de pago

### B.1 Google Gemini API (AI Studio)
Fuente: https://aistudio.google.com/docs/terms (redirige desde ai.google.dev/gemini-api/terms), "Effective March 23, 2026", visto 2026-11-14.
- **Unpaid Services (free tier)**: Google usa el contenido enviado y las respuestas "to provide, improve, and develop" productos y ML; revisores humanos pueden leer/anotar input y output (desvinculados de la cuenta). Texto literal: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
  → **El free tier NO es apto para CVs (datos personales).**
- **Paid Services**: Google no usa prompts ni respuestas para mejorar productos; registra prompts/respuestas "for a limited period of time" solo para detectar abusos; procesamiento bajo el Data Processing Addendum (DPA). Periodo exacto de retención: **no especificado en los términos** (el "55 días" de versiones anteriores **no verificado**).
- Grounding con Google Search: almacena prompts/salida 30 días.
- **Edad: "You must be 18 years of age or older"** y no se permiten API Clients dirigidos o probablemente accedidos por menores de 18. (Relevante si hay usuarios aprendices de 16–17 años.)
- EEE/UK/Suiza: solo Paid Services.

### B.2 Google Vertex AI
- Entrenamiento: "Google won't use your data to train or fine-tune any AI/ML models without your prior permission or instruction." Caché en memoria por defecto, borrado ≤24 h; ZDR posible desactivando logging (off por defecto) y caché. Fuente: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance, visto 2026-11-14.
- Regiones: multi-región `us` y `eu`; regiones individuales incluyen São Paulo (`southamerica-east1`), Montréal, 7 en EE. UU., 10 en Europa; endpoint global. "Don't use the global endpoint if you have ML processing requirements." Disponibilidad exacta de cada modelo Flash por región: **no verificada** (tabla vacía en el fetch). Fuente: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations, visto 2026-11-14.

### B.3 DeepSeek
Fuente: https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html (actualizada 2026-02-10), visto 2026-11-14.
- Datos recolectados, procesados y almacenados en la **República Popular China**.
- Datos personales incluido el input pueden usarse para "train and improve our technology"; hay derecho de oposición por correo (privacy@deepseek.com), sin un switch documentado.
- No da términos separados de retención/entrenamiento para clientes API (solo dice que el desarrollador es responsable de los datos de sus usuarios finales).
- DPA: **no verificado**.
- **China no está en la lista SIC de países adecuados** (ver E).

### B.4 Alibaba Cloud Model Studio (internacional)
- Privacidad: "will never use your data for model training"; retención: no especificada. Fuente: https://www.alibabacloud.com/help/en/model-studio/privacy-notice, visto 2026-11-14.
- Regiones: la región elegida es donde se almacenan los datos; el "scope" decide dónde corre la inferencia. Scope **Global** = sin frontera geográfica (no recomendado si hay requisitos de cumplimiento). Hay región US (Virginia) con scope "US" y Alemania (Frankfurt) con scope "EU". Para Singapur el scope no se indicó en la página. Fuente: https://www.alibabacloud.com/help/en/model-studio/regions/, visto 2026-11-14.
- Precios de la región US/EU: **no verificados** (la tabla leída era la de Singapur).
- DPA: la página remite a "Related agreements"; contenido **no verificado**.

### B.5 Z.ai (GLM)
- Política de privacidad (actualizada 2025-09-29): datos "generally processed in Singapore"; para API, el cliente es responsable y Z.ai encargado; inputs de API "processed in real time and not saved on our servers". Entidad: JINGSHENG HENGXING TECHNOLOGY PTE. LTD., Singapur. Fuente: https://docs.z.ai/legal-agreement/privacy-policy, visto 2026-11-14.
- Términos (actualizados 2026-04-14): no usan End User Content para mejorar servicios salvo consentimiento explícito (cláusula aparece entre corchetes; posible borrador); referencian un "Data Processing Addendum for API Services" cuyo texto no está en la página. Fuente: https://docs.z.ai/legal-agreement/terms-of-use, visto 2026-11-14.
- Si los modelos Flash gratis tienen los mismos términos de no-entrenamiento: **no verificado**.

### B.6 Moonshot / Kimi
Fuente: https://platform.kimi.ai/docs/agreement/userprivacy.md (actualizada 2025-04-30), visto 2026-11-14.
- Responsable: MOONSHOT AI PTE. LTD. (Singapur); servidores en **Singapur**.
- El contenido del usuario se usa para "optimize our models" / entrenamiento; sin switch de exclusión documentado (contacto: api-service@moonshot.ai).
- Existe una página de "Zero Data Retention" para modo empresarial (https://platform.kimi.ai/docs/guide/zero-data-retention.md) — contenido **no verificado**.

### B.7 OpenAI API
Fuente: https://developers.openai.com/api/docs/guides/your-data, visto 2026-11-14.
- No entrena con datos de la API salvo opt-in explícito.
- Logs de monitoreo de abuso: hasta **30 días** por defecto.
- Zero Data Retention: solo clientes aprobados (contactar ventas). Alternativa: Modified Abuse Monitoring.
- Residencia de datos: remite a una guía aparte; regiones **no verificadas**.
- DPA: no mencionado en esa página (OpenAI publica un DPA en https://openai.com/policies/data-processing-addendum/ — visto solo en resultados de búsqueda; contenido no verificado).

### B.8 Anthropic API
- Comercial: "Anthropic may not train models on Customer Content from Services"; DPA "incorporated into these Terms by reference". Fuente: https://www.anthropic.com/legal/commercial-terms, visto 2026-11-14.
- Retención: inputs/outputs de API borrados del backend en **30 días**, salvo ZDR acordado, aplicación de Usage Policy (contenido marcado: hasta 2 años; puntajes de clasificación hasta 7 años) o ley. Fuente: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data, visto 2026-11-14.
- Ubicación: enrutamiento global por defecto; solo-EE. UU. con `inference_geo` (+10%).

### B.9 Groq
Fuente: https://console.groq.com/docs/your-data, visto 2026-11-14.
- Por defecto no retiene datos de inferencia; puede registrar temporalmente hasta 30 días para fiabilidad/abuso. **ZDR activable por cualquier cliente** en Data Controls. Datos retenidos en buckets de GCP en **EE. UU.**; transferencias con cláusulas contractuales tipo.
- Si entrena con datos de API: no lo dice esa página → **no verificado**.

### B.10 Together AI
Fuente: https://docs.together.ai/docs/privacy-and-security, visto 2026-11-14.
- **Por defecto almacena prompts y respuestas** y puede usarlos "for product improvements"; entrenamiento de otros modelos solo con opt-in. Se puede desactivar "Prompt storage" (ZDR). Inferencia geo-US con `us-api.together.ai` para modelos seleccionados.

### B.11 OpenRouter
Fuentes: https://openrouter.ai/docs/faq y https://openrouter.ai/docs/guides/privacy/provider-logging, visto 2026-11-14.
- No registra prompts por defecto (solo metadatos); opt-in de logging da 1% de descuento.
- Cada proveedor subyacente tiene su política; se puede filtrar por proveedores ZDR / sin entrenamiento. Enrutamiento EU/US solo en planes Business/Enterprise.

### B.12 Cloudflare Workers AI
Fuente: https://developers.cloudflare.com/workers-ai/platform/data-usage/, visto 2026-11-14.
- "Cloudflare does not use Customer Content processed by Workers AI to train AI models." Inferencia estándar sin retención del contenido después de responder (salvo AI Gateway logging, R2/KV, batch, etc.).
- Ubicación de la inferencia: **no especificada** en esa página → no verificado.

### B.13 Tabla resumen (paid API)
| Proveedor | ¿Entrena con API? | Retención por defecto | Ubicación | DPA | País en lista SIC |
|---|---|---|---|---|---|
| Gemini API pagada | No | "limited period" (abuso) | Google global (no fijable en AI Studio) | Sí (Data Processing Addendum) | EE. UU. sí |
| Gemini free | **Sí** + revisión humana | — | — | — | No usar con datos personales |
| Vertex AI | No | caché ≤24 h; ZDR posible | Región elegible (us/eu/São Paulo…) | Sí (Cloud DPA, no verificado aquí) | EE. UU./UE sí; Brasil no listado |
| OpenAI | No (opt-in) | 30 días (abuso); ZDR con aprobación | EE. UU. por defecto | DPA publicado (no verificado) | EE. UU. sí |
| Anthropic | No | 30 días; ZDR por acuerdo | Global / US-only +10% | Sí, incorporado | EE. UU. sí |
| Groq | No verificado | ≤30 días; ZDR self-service | EE. UU. (GCP) | SCC mencionadas | EE. UU. sí |
| Cloudflare | No | Sin retención en inferencia estándar | No verificado | No verificado | — |
| Together | No (opt-in) pero **guarda prompts por defecto** | Hasta borrar; ZDR desactivando storage | EE. UU. | No verificado | EE. UU. sí |
| DeepSeek | **Sí puede** | Mientras exista la cuenta | **China** | No verificado | **No** |
| Alibaba Intl. | "Never" | No especificada | Singapur / US / Frankfurt; scope global | No verificado | Singapur **no**; EE. UU./Alemania sí |
| Z.ai | No (salvo opt-in) | API no guardada | Singapur | Referenciado, texto no visto | **No** |
| Moonshot | **Sí** | Mientras cuenta activa | Singapur | No verificado | **No** |

---

## C) Competidores: qué modelos/subencargados declaran

### C.1 JobStep (jobstep.io)
- Home (https://jobstep.io/, visto 2026-11-14): herramienta de CV + matching + cartas + tracker; "120,000+ JobStep users". Planes: **Gratis (€0,00/mes)**: Resume Score, AI Resume Creation, todas las plantillas, Job Tracker. **Mensual** y **Trimestral** (cobro "/mes"): Tailor Resume to Jobs, Cover Letter, **Unlimited Downloads**; Trimestral con "100% Money Back Guarantee". Pagos vía Stripe, "cancela cuando quieras".
- Versión /es (https://jobstep.io/es, visto 2026-11-14): precios en **euros**; los montos de los planes pagos **no se renderizaron** (probable JS/geolocalización).
- **Precio en COP (~COP 12.300): no verificado.** No se encontró en web search.
- Modelo de cobro: suscripción recurrente; las descargas ilimitadas son función paga (indica un **paywall de descarga**), pero el límite de descargas del plan gratis no está publicado → "pagar al final" **no verificado** como flujo exacto.
- Privacidad (https://jobstep.io/en/privacy, vigente desde 2025-01-15, visto 2026-11-14): proveedor IA declarado **OpenAI (GPT-5)**; "Data sent to OpenAI is not used to train their models per our agreement." Otros: Exa.ai, Firecrawl, Cloudflare R2, Railway/AWS (Postgres en UE: Irlanda/Frankfurt), Firebase Auth, Stripe, PostHog, Sentry, Better Stack, TikTok/Meta/Google Ads, Cal.com. Opera desde Zúrich, Suiza.

### C.2 Teal
https://www.tealhq.com/privacy-policy, visto 2026-11-14: nombra **OpenRouter** y **Anthropic Claude en Amazon Bedrock vía OpenRouter con ruta de zero data retention** (para Gmail). Proveedores de procesamiento de CV no nombrados; declara que no usa CVs/cartas/descripciones para entrenar y que los proveedores no entrenan con ello. Sin lista de subencargados enlazada.

### C.3 Kickresume
https://www.kickresume.com/en/privacy/ (vigente desde 2026-08-03), visto 2026-11-14: nombra **OpenAI OpCo, LLC** y **Anthropic** para servicios IA; transferencias principalmente a EE. UU. bajo EU-US Data Privacy Framework o cláusulas tipo. Puede entrenar sus propios sistemas con datos "strictly anonymised". Responsable: Kickresume s.r.o., Bratislava.

### C.4 Rezi
https://www.rezi.ai/privacy (sin fecha), visto 2026-11-14: no nombra proveedores de IA (solo Stripe). Página "AI Information" (https://www.rezi.ai/ai-llm-info) tiene **placeholders** ("[insert AI framework / model]") — no divulga proveedor.

### C.5 Resume Worded
https://www.resumeworded.com/privacy.html (actualizada 2025-02-15), visto 2026-11-14: nombra **OpenAI, Google Gemini y Anthropic**; dice que están contractualmente obligados a no entrenar con datos de API y que optó por salir de programas de entrenamiento.

### C.6 Enhancv
https://enhancv.com/privacy/ (actualizada 2024-07-23), visto 2026-11-14: nombra solo **OpenAI** bajo "AI Technologies"; nada sobre entrenamiento.

### C.7 Huntr
https://www.huntr.co/privacy-policy, visto 2026-11-14: la página no cargó contenido (solo título) → **no verificado**.

Patrón del mercado: los competidores declaran por nombre al proveedor LLM (mayoría OpenAI; Anthropic y Gemini en segundo lugar) y afirman "no entrenamiento". Ninguno usa proveedores chinos según lo divulgado.

---

## D) Pagos e infraestructura

### D.1 Wompi (Colombia)
Fuente oficial: https://wompi.com/es/co/planes-tarifas/, visto 2026-11-14.
- **Plan Avanzado: 2,65% + $700 COP + IVA** por transacción exitosa.
- **Código QR (Plan Avanzado): 1%** por transacción exitosa.
- Plan Avanzado con Puntos Colombia: misma tarifa + 1,44% cuando el cliente acumula puntos (tarjetas y PSE).
- Plan Gateway: Wompi no cobra; se paga lo negociado con cada banco.
- **Desglose oficial por medio (tarjetas, PSE, Nequi, Botón Bancolombia): no publicado en esa página → no verificado.** (Un blog de terceros cita 2,99% + IVA + COP 600 tarjetas; PSE 1,49% + COP 1.200; Nequi 1,79% — **no oficial, no verificado**.)
- Medios disponibles (https://docs.wompi.co/en/docs/colombia/metodos-de-pago/, visto 2026-11-14): tarjetas Visa/Mastercard, Botón Bancolombia, QR Bancolombia (Bancolombia y Nequi, solo personas naturales), Nequi, PSE, efectivo en corresponsal Bancolombia, Puntos Colombia, BNPL Bancolombia (desde COP 100.000), Daviplata, SU+ PAY (COP 35.000–5.000.000).
- Cálculo propio para un cobro de **COP 12.300** con Plan Avanzado: 2,65% = 326 + 700 = 1.026; + IVA 19% = **≈ COP 1.221 (≈ 9,9% del precio)**. El componente fijo pesa mucho en tickets bajos; con QR (1%) serían ≈ COP 123 (+ IVA si aplica; no verificado si el 1% lleva IVA).

### D.2 Render
- Starter: **$7/mes, 0.5 CPU, 512 MB RAM** (ID `0.5c-512mb`, nombre legacy `starter`). Especificaciones: https://render.com/docs/compute-plans; precio $7 visto en resultados de búsqueda de https://render.com/pricing (la página no renderizó cifras en el fetch) — visto 2026-11-14. Standard: 1 CPU / 2 GB (precio no verificado). Workspace Hobby $0 / Pro $25 (según extracto de páginas de render.com en búsqueda; no confirmado en fetch directo).
- Free: se duerme tras 15 min sin tráfico (~1 min en despertar), 750 h/mes por workspace, sin disco persistente. Fuente: https://render.com/docs/free, visto 2026-11-14.

### D.3 Supabase
Fuente: https://supabase.com/pricing, visto 2026-11-14.
| | Free | Pro |
|---|---|---|
| Precio | $0 | desde $25/mes |
| Base de datos | 500 MB por proyecto | 8 GB disco/proyecto, luego $0.125/GB |
| File storage | 1 GB | 100 GB, luego $0.0213/GB |
| Egress | 5 GB | 250 GB, luego $0.09/GB |
| MAU | 50.000 | 100.000, luego $0.00325/MAU |
| Pausa | tras 1 semana inactivo | nunca |
| Backups diarios | No | 7 días |
| Créditos compute | — | $10/mes (1 instancia Micro) |
- Free: máximo 2 proyectos activos.
- Implicación: guardar PDFs de CV originales en Storage consume rápido 1 GB del Free; para CVs conviene guardar solo el JSON estructurado y el PDF generado bajo demanda, o borrar archivos fuente tras procesarlos.

---

## E) Marco legal colombiano

### E.1 Ley 1581 de 2012
Texto consultado en el normograma oficial de la DIAN: https://normograma.dian.gov.co/dian/compilacion/docs/ley_1581_2012.htm, visto 2026-11-14. (secretariasenado.gov.co rechazó la conexión; funcionpublica.gov.co dio error de certificado TLS ese día.)
- **Art. 26 (transferencia a terceros países)**: "Se prohíbe la transferencia de datos personales de cualquier tipo" a países sin niveles adecuados de protección. Excepciones: (a) autorización **expresa e inequívoca** del Titular; (b) intercambio de datos médicos por razones de salud/higiene pública; (c) transferencias bancarias o bursátiles; (d) tratados internacionales con reciprocidad; (e) transferencias necesarias para ejecutar un contrato entre Titular y Responsable, o medidas precontractuales, con autorización del Titular; (f) exigidas legalmente por interés público o defensa judicial (la Corte, Sentencia C-748/11, condicionó este literal). Fuera de estas, la SIC emite **declaración de conformidad**.
- **Art. 14 (consultas)**: máximo **10 días hábiles** desde recibo; prórroga máxima de **5 días hábiles** informando motivos.
- **Art. 15 (reclamos)**: máximo **15 días hábiles** desde el día siguiente al recibo; prórroga máxima de **8 días hábiles**; leyenda "reclamo en trámite" mientras se resuelve. Si el reclamo está incompleto se requiere subsanar dentro de 5 días.
- **Art. 25 (RNBD)**: directorio público de bases de datos sujetas a tratamiento, administrado por la SIC.
- **Art. 23 (sanciones)**: multas hasta **2.000 SMMLV**, repetibles mientras persista el incumplimiento; suspensión de actividades hasta 6 meses; cierre temporal; cierre inmediato y definitivo si se tratan datos sensibles.

### E.2 Decreto 1074 de 2015 (compila Decreto 1377 de 2013)
Fuente: https://cancilleria.gov.co/sites/default/files/Normograma/docs/pdf/decreto_1074_2015_pr026.pdf, visto 2026-11-14 (funcionpublica.gov.co no accesible por error TLS).
- **Art. 2.2.2.25.5.1**: transferencias internacionales → se rigen por art. 26 Ley 1581. **Transmisiones** internacionales entre Responsable y Encargado **no requieren informar al Titular ni su consentimiento** cuando existe contrato conforme al art. 2.2.2.25.5.2.
- **Art. 2.2.2.25.5.2 (contrato de transmisión)**: debe señalar alcances del tratamiento, actividades del Encargado por cuenta del Responsable, y obligaciones del Encargado: tratar datos según la política del Responsable y finalidades autorizadas, dar seguridad a las bases y guardar confidencialidad.
  → Para BuscoTrabajo: el proveedor LLM actúa como **Encargado**; el contrato de transmisión puede ser el DPA/términos del proveedor **si cubre esos mínimos** (verificar cláusula por cláusula; recomendable un anexo propio).
- **RNBD**: art. 2.2.2.26.1.2 — obligados: **sociedades y entidades sin ánimo de lucro con activos totales > 100.000 UVT** y personas jurídicas de naturaleza pública. Art. 2.2.2.26.1.3: inscribir cada base de datos de forma independiente.
  - **Personas naturales**: no están en la lista de obligados según el texto visible → no obligadas a inscribir (pero sí a cumplir el resto de la Ley 1581). Interpretación propia, confirmar con abogado.
  - Valor en pesos de 100.000 UVT para 2026: **no verificado** (depende de la UVT 2026; fuentes de terceros citan ~COP 4.700–5.000 millones para años anteriores).
  - Actualización anual (según terceros, hasta 31 de marzo) → no verificado en fuente oficial.

### E.3 SIC — Circular Externa 005 de 2017 (lista de países adecuados; hoy numeral 3.2, Cap. III, Título V de la Circular Única)
Fuente: https://cancilleria.gov.co/sites/default/files/Normograma/docs/circular_superindustria_0005_2017.htm, visto 2026-11-14.
- Lista: Alemania; Austria; Bélgica; Bulgaria; Chipre; Costa Rica; Croacia; Dinamarca; Eslovaquia; Eslovenia; Estonia; España; **Estados Unidos de América**; Finlandia; Francia; Grecia; Hungría; Irlanda; Islandia; Italia; Letonia; Lituania; Luxemburgo; Malta; México; Noruega; Países Bajos; Perú; Polonia; Portugal; Reino Unido; República Checa; República de Corea; Rumania; Serbia; Suecia; + los países declarados adecuados por la Comisión Europea.
- **Estados Unidos: SÍ. China: NO. Singapur: NO.** (Ninguno de los dos está en la lista ni, hasta donde se sabe, tiene decisión de adecuación de la Comisión Europea — esto último es conocimiento general, no verificado en esta sesión.)
- Modificaciones posteriores: Circular 008 de 2017 añadió **Japón**; Circular 002 de 2018 (Australia aparece en su listado según extracto) — fuente: https://normas.cra.gov.co/gestor/docs/circular_superindustria_0002_2018.htm (visto solo en resultados de búsqueda; **no verificado** en lectura directa).
- Parágrafo del numeral 3.2: la **transmisión** a países con nivel adecuado es posible. Numeral 3.3: si el destino no está en la lista y no aplica excepción, se pide **declaración de conformidad**; pero si se firma contrato/instrumento que fije condiciones, "se presumirá que la operación es viable y que cuenta con Declaración de Conformidad", con **comunicación previa a la Delegatura para la Protección de Datos Personales**.
- La SIC insiste en que estar en la lista no basta: el exportador debe demostrar responsabilidad (accountability). (Resultados de búsqueda; no verificado en texto oficial.)
- Existe una Circular Externa 002 de 2025 y 003 de 2025 de la SIC sobre cláusulas contractuales modelo para transferencias (https://cancilleria.gov.co/normograma/compilacion/docs/circular_superindustria_0002_2025.htm; https://sedeelectronica.sic.gov.co/sites/default/files/normativa/Circular%20Externa%20003%20de%202025.pdf) — **contenido no verificado** (solo vistas en resultados de búsqueda).
- Prensa (agosto 2026) reporta un estudio SIC que recomienda añadir Brasil, Ecuador, Kenia, Panamá y Sudáfrica — recomendación, **no norma vigente** (https://www.asuntoslegales.com.co/..., no oficial).

### E.4 SIC — Circular Externa 002 de 2024 (datos personales en sistemas de IA)
- Existe: PDF oficial https://sedeelectronica.sic.gov.co/sites/default/files/normativa/Circular%20Externa%20No.%20002%20del%2021%20de%20agosto%20de%202024.pdf (fecha 21-ago-2024). El PDF es escaneado (imagen) y **no pudo leerse en texto** el 2026-11-14.
- Contenido según resumen secundario (https://www.cerlatam.com/normatividad/sic-circular-externa-002-de-2024/, no oficial, visto 2026-11-14):
  1. Ante incertidumbre sobre daños potenciales, abstenerse de tratar o adoptar medidas precautorias.
  2. Adaptar sistemas de gestión de riesgos al tratamiento en IA (identificar, clasificar, medir, monitorear, controlar).
  3. Datos tratados en IA deben ser veraces, completos, exactos, actualizados, comprobables y comprensibles.
  4. Información "accesible al público" no es por sí sola información de "naturaleza pública".
  5. Estrategias pertinentes, eficaces y demostrables para garantizar derechos de los Titulares.
- Marcar como **parcialmente verificado** (existencia y fecha sí; texto exacto no).

### E.5 Consecuencias prácticas para el CV builder (análisis, no asesoría legal)
1. Enviar CVs a un LLM = **transmisión** a un Encargado (el proveedor procesa por cuenta de BuscoTrabajo). Si el proveedor está en EE. UU. (OpenAI, Anthropic, Google, Groq) → país en lista SIC; basta **contrato de transmisión** (DPA que cubra art. 2.2.2.25.5.2) + informarlo en la política de tratamiento. Sin necesidad de consentimiento específico para la transmisión (aunque sí autorización general para la finalidad).
2. Proveedores en **China (DeepSeek)** o **Singapur (Z.ai, Moonshot, Alibaba Intl. Singapur)** → país NO adecuado: requiere autorización **expresa e inequívoca** (art. 26 a) o contrato + comunicación previa a la SIC (numeral 3.3). DeepSeek además puede entrenar con los datos → **no recomendable**.
3. Gemini **free tier prohibido** para CVs por los propios términos de Google.
4. Plazos operativos a implementar: consultas 10 días hábiles (+5), reclamos 15 días hábiles (+8).
5. RNBD: solo si BuscoTrabajo es sociedad con activos > 100.000 UVT; persona natural no obligada (confirmar).
6. Documentar evaluación de riesgos de IA (Circ. 002/2024) y minimizar datos enviados al LLM (p. ej. quitar cédula, dirección, teléfono antes del prompt).

---

## F) Google AdSense / Publisher Policies

### F.1 Contenido de bajo valor ("Inventory value")
Fuente: https://support.google.com/adsense/answer/10502938 (Google Publisher Policies), visto 2026-11-14.
- No se permiten anuncios en pantallas "without publisher-content or with low-value content", en construcción, o usadas para alertas, navegación u otros fines de comportamiento.
- No en pantallas con contenido replicado sin comentario/curaduría/valor añadido.
- No donde haya "more ads or other paid promotional material than publisher-content".
- Página específica: https://support.google.com/publisherpolicies/answer/11112688 ("Google-served ads on screens without publisher-content") — ejemplos de pantallas "dead end"/sin contenido: **Thank You, Log in, Exit, Error** (según extracto de búsqueda, visto 2026-11-14). Sanción típica: **restricted ad serving**.
- Aplicado a herramientas: un editor/wizard de CV, pantalla de login, checkout, "gracias por tu compra" y pantalla de descarga son pantallas funcionales → **sin anuncios**. Una landing con contenido editorial real (guía de cómo hacer hoja de vida + herramienta) sí puede llevar anuncios.

### F.2 Ubicación de anuncios
Fuente: https://support.google.com/adsense/answer/1346295 (Ad placement policies), visto 2026-11-14.
- Cuidado con links, botones o menús cerca de anuncios que "might lead to accidental clicks"; aun sin intención se puede recibir notificación de violación → **no poner anuncios junto a botones de "Descargar CV", "Pagar" ni campos de formulario**.
- No disfrazar anuncios ni ponerlos bajo encabezados engañosos ("resources", "helpful links"); etiquetarlos "Advertisements"/"Sponsored Links" (o "Anuncios"/"Publicidad").
- No incentivar clics; no flechas ni animaciones que atraigan atención a anuncios.
- Pop-ups: no anuncios en ventanas abiertas sin interacción intencional; no más de 3 pop-ups; no pop-unders.
- No anuncios en pantallas cuyo foco principal es comunicación privada (chats, mensajes).
- Google puede desactivar anuncios en contenido que "cannot evaluate" (p. ej. contenido detrás de login).
- Programa general: https://support.google.com/publisherpolicies/answer/48182 (no leído en detalle).

---

## Recomendación técnica resumida (derivada de lo anterior)
1. **Primera opción costo/legal**: Gemini 2.5 Flash-Lite **de pago** ($0.10/$0.40) — pero deprecación en curso de la familia 2.5 (2.5 Flash se redirige el 2026-12-01); planificar migración a 3.1 Flash-Lite ($0.25/$1.50). Requisito 18+ en términos de Gemini API.
2. **Alternativas equivalentes legalmente (EE. UU., sin entrenamiento, DPA)**: gpt-5-nano ($0.05/$0.40, ojo tokens de razonamiento, 30 días retención abuso), Claude Haiku 5.5 ($0.10/$0.50, 30 días, DPA incorporado), Groq gpt-oss-20b ($0.075/$0.30, ZDR self-service, datos en EE. UU.).
3. **Evitar** con datos de CV: Gemini free tier, DeepSeek (China + entrenamiento), Moonshot (entrenamiento), Together sin desactivar prompt storage. Z.ai/Alibaba Singapur solo con autorización expresa o contrato + aviso SIC.
4. El costo LLM por CV (< USD 0.01) es irrelevante frente a Wompi (~COP 1.221 por cobro de COP 12.300 con Plan Avanzado); el precio del producto debe cubrir sobre todo la pasarela.
