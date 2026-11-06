# Checkpoint SEO 2026-11-06 y plan hacia 1.000 registros orgánicos

Fecha: 2026-11-06 (America/Bogota). Producción `main@46e6587` (PR #113 AdSense).
Fuentes leídas hoy con la sesión del propietario: Search Console (propiedad
`sc-domain:buscotrabajo.co`), GA4 (propiedad 547156816) y Supabase (consultas
de solo lectura). Mismo método que la línea base
`2026-10-24-measurement-baseline.md` y el checkpoint del 1 de noviembre.
Este documento es análisis y plan; no implementa nada.

## 1. ¿Se cumplió la meta?

La meta del plan de crecimiento era +500 % (x6) o +1.500 % (x16) sobre la base
del 24 de octubre. Comparación con cantidades absolutas:

| Indicador                         | Base (16–22 oct) | Ahora (29 oct–4 nov / 31 oct–6 nov) | Cambio |
| --------------------------------- | ---------------- | ----------------------------------- | ------ |
| Clics GSC / semana                | 7                | 585                                 | x84    |
| Impresiones GSC / semana          | 442              | 10.600                              | x24    |
| Posición media                    | 12,4 (90 d)      | 6,4 (7 d)                           | mejora |
| Clics a `/empleos/*` / día        | 0–1              | 157 (4 nov)                         | —      |
| Registros reales / semana (BD)    | 11               | 411 (6 nov aún abierto)             | x37    |
| Usuarios registrados totales (BD) | —                | 592                                 | —      |

Registros reales = `auth.users` sin cuentas de prueba (yopmail, example-test).

**Sí, la meta de x16 se superó en clics y en registros.** Pero una parte del
salto no viene del SEO (sección 3), así que no hay que atribuirlo todo a las
fases F2–F5.

Registros por día (BD): 26 oct 8 · 27: 9 · 28: 6 · 29: 11 · 30: 12 · 31: 10 ·
**1 nov 40 · 2 nov 118 · 3 nov 91 · 4 nov 72 · 5 nov 49 · 6 nov 31 (parcial)**.

## 2. Search Console

- 28 días: 653 clics, 13,7 mil impresiones, CTR 4,8 %, posición 6,9.
- Clics diarios: 1–4 nov = 65, 162, 116, 176. Impresiones el 4 nov: 3.568.
- Países (7 d): Colombia 513 clics, Venezuela 65.
- Dispositivo (28 d): móvil 422, ordenador 226, tablet 5.
- Google Empleos (28 d): «Ofertas de empleo» 205 clics / 3.824 impresiones;
  «Detalles de empleos» 114 / 5.773. Son 319 de 653 clics (49 %).

### Marca frente a SEO real (separación por página)

El filtro de consulta deja fuera las consultas anonimizadas (la mayor parte de
la cola larga), así que la separación se hace por página:

| Día       | Portada `/` (≈ marca) | `/empleos/*` (≈ SEO real) |
| --------- | --------------------- | ------------------------- |
| 26–31 oct | 0–7 / día             | 10–26 / día               |
| 1 nov     | 39                    | 28                        |
| 2 nov     | **122**               | 39                        |
| 3 nov     | 58                    | 64                        |
| 4 nov     | 37                    | **157**                   |

Las páginas `/empleos/*` tuvieron 3.826 impresiones el 4 de noviembre, frente a
unas 41–69 al día antes del 25 de octubre. **El crecimiento SEO es real y sigue
acelerando.** El pico de la portada es otro fenómeno.

### Indexación: el informe que asusta está desactualizado

- El informe «Páginas» (569 indexadas, 29,5 mil sin indexar) dice
  **«Última actualización: 22/10/26»**. Es anterior a todos los cambios del
  25 de octubre al 3 de noviembre, así que no puede medir su efecto. Las
  cifras son idénticas a las del 1 de noviembre.
- Evidencia directa: en 7 días, **más de 1.000 URL de `/empleos/*` tuvieron
  impresiones** (el límite de la tabla es 1.000; incluye unos 90 hubs). En la
  base, eran 283 URL de vacante en 3 meses.
- Muestra de inspección de URL (hoy, 10 vacantes del sitemap):
  - Con `lastmod` del 27 al 29 de octubre: **5 de 5 indexadas**.
  - Con `lastmod` del 3 al 4 de noviembre: **1 de 5 indexada**. Las otras 4
    están en «Descubierta: actualmente sin indexar», encontradas por el
    sitemap y todavía sin rastrear.
- Sitemaps: `sitemap-jobs.xml` tiene 10.321 URL. Google lo leyó el
  5 de noviembre sin errores.

### ¿Funciona la indexación automática? Sí, pero el límite es la capacidad

Cola `indexing_queue` (solo lectura):

- Enviadas por día (26 oct–5 nov): unas 100 `URL_UPDATED` y 100 `URL_DELETED`.
  Desde el 2 de noviembre, unas 93–98 de cada tipo (envío repartido de F2). El
  29 de octubre no hubo envíos.
- Fallos en 7 días: 1.
- Pendientes: 3.991 `URL_UPDATED` y 272 `URL_DELETED`.
- Cada día pasan a estar aptas para Google unas 490 vacantes nuevas (sección
  siguiente). La API solo notifica unas 95 actualizaciones al día, es decir,
  alrededor del 20 %. El resto depende del rastreo del sitemap, que tarda
  varios días.

Conclusión: las vacantes sí se indexan, pero con **3 a 7 días de retraso**. Una
vacante dura unos 30 días, así que ese retraso es tiempo de vida perdido.

### ¿Funciona el trabajo de las descripciones? Lectura preliminar de F3

Vacantes creadas en los últimos 7 días y cuántas llegaron a estar aptas para
Google (`seo_ready_at`), consulta de solo lectura. La medición formal de F3
está prevista para el 9 de noviembre.

| Fuente                                                  | Nuevas 7 d | Aptas | %        | Mediana creada→apta | Base F0 (1 nov)                     |
| ------------------------------------------------------- | ---------- | ----- | -------- | ------------------- | ----------------------------------- |
| LinkedIn                                                | 3.887      | 805   | 21 %     | 0 h                 | 21 % CO                             |
| Magneto                                                 | 1.811      | 1.591 | **88 %** | 0,2 h               | atraso 107–113 h                    |
| Computrabajo                                            | 1.228      | 51    | 4 %      | 7,1 h               | 2 % CO                              |
| Elempleo                                                | 568        | 561   | 99 %     | 0 h                 | —                                   |
| Portal oficial                                          | 515        | 393   | 76 %     | 0 h                 | ~72/día                             |
| WeRemoto                                                | 53         | 17    | 32 %     | 0 h                 | —                                   |
| Workana, Glassdoor, Indeed, GetOnBoard, RemoteOK, Torre | 1.440      | 0     | 0 %      | —                   | excluidas a propósito o sin detalle |

- Aptas por día: unas **490** (3.418 en 7 días), frente a ~358 en F0 (286 no
  oficiales + ~72 oficiales).
- **F3 funcionó en Magneto**: el atraso de 4–5 días desapareció.
- LinkedIn sigue en 21 % y Computrabajo en 4 %. Son bloqueos de la fuente
  (robots/anti-bot y 429), no errores del parser, según los diagnósticos del
  25 de octubre. La salida sigue siendo una decisión del propietario
  (empleadores directos, acuerdos de feed), sin saltarse controles.

### Consultas con demanda y sin página propia (28 d, sin marca)

- Intención + ciudad: «trabajos en medellín sin experiencia» (57 impresiones,
  posición 3,1); «trabajo sin experiencia medellin» (43; 2,7); «trabajo medio
  tiempo medellin» (41; 2,1); «trabajo por temporada sin experiencia».
- Municipios sin hub: «vacantes tierralta» (155 impresiones, posición 1,1,
  sostenido por una sola vacante); «vacantes/empleos barrancabermeja» (40;
  7–10); Puerto Ordaz (49 en tres variantes), Maturín, Nueva Esparta,
  Valencia Carabobo.
- «part time jobs near me»: 172 impresiones, posición 1,2, 0 clics.
- Hoy los hubs son solo ciudad (27) o solo rol (32 CO + 32 VE). No existe
  ciudad × intención ni hubs de municipios medianos.

## 3. GA4 (28 días, 9 oct–5 nov)

- Sesiones 2.620; usuarios activos 7 d: 1,2 mil (+345 %).
- Canales (sesiones): Direct 1.237 · Organic Search 790 · **AI Assistant 320**
  · Referral 211 · Organic Social 56.
- Fuente/medio: google/organic 659 · **chatgpt.com/ai-assistant 318** ·
  accounts.google.com 192 (vuelta del login de Google; está como referencia
  no deseada desde el 2 de noviembre, así que deja de contar en sesiones
  nuevas) · google_jobs_apply 132 · t.co 37.
- Eventos `sign_up` por fuente de sesión (son eventos, no personas; el total
  es 524 eventos de 351 usuarios): google/organic 215 (41 %), direct 170
  (32 %), **chatgpt.com 94 (18 %)**, google_jobs_apply 33 (6 %).
- ChatGPT tiene la mejor tasa de eventos clave por sesión: 27 %, frente a
  18 % de Google orgánico.
- Páginas a las que llega ChatGPT: hubs de ciudad (`/empleos/valledupar`,
  `/monteria`, `/cali`, `/cartagena`, `/santa-marta`) y vacantes concretas.
- Embudo (usuarios, 28 d): `view_job` 1.015 → `apply_gate_open` 554 →
  `sign_up` 351 / `onboarding_complete` 355 → `outbound_apply` 340.

### El pico del 1–4 de noviembre fue algo fuera del sitio

Estas señales lo indican:

- Las consultas de marca pasaron de casi 0 a 192 clics por semana.
- La portada pasó de 0–7 a 122 clics al día.
- GA4 marcó un valor atípico en Direct: 130 sesiones frente a 8 esperadas.
- Los registros llegaron a 118 al día y luego bajaron (49, 31).

**Causa confirmada por el propietario: TikTok orgánico, sin anuncios.** Los
videos son de su cuenta personal `@kyubiixtv` (308 seguidores). Las fechas se
leen del ID del video, en hora de Bogotá; las vistas son las de la captura
del 6 de noviembre:

| Publicado     | Video                                                              | Vistas   |
| ------------- | ------------------------------------------------------------------ | -------- |
| 31 oct, 09:42 | Fijado, «Esto me dejó loco…» (#buscotrabajo)                       | 46,1 mil |
| 1 nov, 18:45  | Respuesta a un comentario (filtrar LinkedIn, conectar plataformas) | 750      |
| 2 nov, 08:38  | Respuesta: «¿es de pago?»                                          | 775      |
| 2 nov, 08:41  | Respuesta: qué opina la IA de tener que crear cuenta               | 851      |
| 4 nov, 20:47  | «Buscas trabajo? / Trabajito sí hay»                               | 5.595    |

- La secuencia cuadra con los registros: 10 (31 oct) → 40 → **118** → 91 →
  72 → 49 → 31.
- Unas **54 mil vistas trajeron unos 400 registros** por encima de la base
  de ~10/día, es decir, **~0,7 % de vistas → registro**.
- TikTok no aparece como fuente en GA4. Su navegador interno no envía
  referencia, así que el tráfico cae en Direct. Además, mucha gente vio el
  video y luego buscó la marca en Google: de ahí el salto de «buscotrabajo
  co» y de la portada.
- Los comentarios respondidos muestran las dudas reales del público: si es
  de pago (están cansados de páginas que cobran), por qué pedir cuenta, y si
  conecta o filtra LinkedIn y otras plataformas. Conviene responderlas en la
  portada y en el registro, y también en las preguntas de la Fase D.
- No se pudo leer el contenido ni los comentarios de los videos: TikTok
  responde 403 al navegador automatizado y no se intentó saltar ese bloqueo.

Implicación para la meta: con ~0,7 %, 1.000 registros al día solo desde
TikTok exigirían ~140 mil vistas diarias. Combinado con el SEO, TikTok es la
palanca de crecimiento más rápida que se ha medido hasta hoy, y además
alimenta las búsquedas de marca en Google.

## 4. Riesgos detectados

1. **AdSense Auto ads (#113, 5 nov)** carga en todas las páginas, también en
   las vacantes. Cuando la cuenta se apruebe, los anuncios automáticos pueden
   empujar el botón «Aplicar», bajar la conversión a registro y empeorar
   LCP/CLS/INP (invariante protegido del runbook). No está medido; hay que
   medir antes y después y excluir las vacantes y la zona de aplicar si hace
   falta.
2. **El SSR de la portada (#112) sigue sin desplegar.** Hoy la portada recibe
   la mayor parte del tráfico de marca.
3. **Capacidad de Supabase (Nano).** Con 10 veces más tráfico y el antecedente
   de Disk IO del 3 de noviembre, hay que vigilar IO y memoria antes de crecer
   otra vez 10 veces.
4. **Cuota de la Indexing API (200/día).** No se puede pagar; hay que
   priorizar mejor dentro de la cuota.

## 5. Qué significa «1.000 registros» en números

Hoy hay aproximadamente **1 registro por cada 5–6 sesiones** (481 registros
reales frente a 2.620 sesiones en 28 días). La exigencia de cuenta para
aplicar (decisión del propietario) es lo que convierte.

| Meta           | Registros/día | Sesiones/día necesarias | Frente a hoy (~350/día)                                                                          |
| -------------- | ------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| 1.000 en total | —             | —                       | Faltan ~408; al ritmo actual de 30–50/día, unas 2 semanas                                        |
| 1.000 / mes    | 33            | ~185                    | En el límite: Google + IA + Google Empleos suman ~150–200 sesiones/día, entre 750 y 1.200 al mes |
| 1.000 / semana | 143           | ~800                    | x2,3                                                                                             |
| 1.000 / día    | 1.000         | ~5.500                  | x15; horizonte de 6–12 meses                                                                     |

**Meta confirmada por el propietario (2026-11-06): 1.000 registros al día**,
solo con tráfico orgánico.

### Lo que exige 1.000 al día

Son unas 5.500 sesiones al día con la conversión actual, 15 veces lo de hoy.
Los hitos de abajo son metas de trabajo, no pronósticos. Se revisan en cada
checkpoint con cantidades absolutas.

| Hito             | Registros/día sostenidos (sin picos) | Sesiones/día |
| ---------------- | ------------------------------------ | ------------ |
| Hoy              | ~30–50                               | ~350         |
| Fin de noviembre | 100                                  | ~550         |
| Fin de enero     | 250                                  | ~1.400       |
| Fin de marzo     | 500                                  | ~2.750       |
| Mayo–junio       | 1.000                                | ~5.500       |

De dónde tiene que salir ese volumen, y qué lo limita hoy:

1. **Vacantes indexadas y frescas (Google Empleos + `/empleos/<uuid>`)**,
   hoy cerca de la mitad de los clics. El límite es la oferta: LinkedIn
   (21 % aptas) y Computrabajo (4 %) no entregan descripción. La palanca es
   ampliar empleadores oficiales (iniciativa direct-employers) y acuerdos de
   feed, sin saltarse controles. Fases B y C.
2. **Hubs de intención y municipios**: cientos de páginas útiles con guardas,
   en lugar de 90. Fase C.
3. **Asistentes de IA**: hoy el 12 % de las sesiones y la mejor conversión.
   Fase D, más IndexNow/Bing en la Fase B.
4. **Retorno y marca**: a esta escala hace falta que la gente vuelva. Las
   alertas de vacantes (Fase E) pasan a ser prioritarias, no opcionales.
5. **Difusión orgánica repetible** (Fase F, TikTok), medida con `utm`.

Orden de ejecución ajustado: **B → A → C → D → E**. A va en paralelo cuando
no toque los mismos archivos. **F (TikTok) empieza ya**: no necesita código,
y el enlace medible llega con la Fase A.

Capacidad que hay que preparar antes de multiplicar el tráfico por 5:

- Supabase Nano: el cambio a Micro no cuesta más en el plan Pro; requiere
  decisión del propietario.
- Disk IO, según el antecedente del 3 de noviembre.
- TTFB de Render Starter, con el invariante del runbook.
- Cuota de 200/día de la Indexing API: no escala, así que el sitemap e
  IndexNow tienen que cargar con el resto.

## 6. Plan de implementación (una fase por sesión)

Orden por impacto y riesgo. Cada fase tiene criterio de salida medible y se
mide en el checkpoint siguiente. Nada de pago.

### Fase A — Medición y atribución de registros (base para todo)

- Guardar en el registro, sin PII, el primer contacto: ruta de llegada, host
  de referencia y `utm_*`. Es una columna nueva en producción: hay que
  mostrar el SQL y esperar aprobación.
- Checkpoint semanal reproducible: GSC separado por página (portada vs
  `/empleos/*` vs hubs), GA4 `sign_up` por usuarios y la cola de indexación.
- Aclarar la causa del pico del 2 de noviembre.
- Salida: saber cuántos registros trae cada canal y cada tipo de página.

### Fase B — Indexar más rápido las vacantes nuevas (SEO + Google Empleos)

**Estado (2026-11-06):** implementada en `codex/seo-fase-b-indexing` (ADR 0011), sin desplegar: sitemap reciente, «Nuevas hoy» e IndexNow en dry-run. La priorización de `URL_UPDATED` por demanda queda fuera (exige enmendar el ADR 0004). Detalle y verificación: fila 23 de `docs/SEO-IMPROVEMENT-PLAN.md`.

- `sitemap-jobs-recent.xml` con las vacantes de las últimas 48–72 h, con
  `lastmod` real, enlazado desde el índice.
- Los hubs de ciudad y de rol (rastreados a menudo) enlazan las vacantes más
  nuevas en el HTML del servidor («Nuevas hoy»).
- Priorizar `URL_UPDATED` por demanda: ciudades y roles con impresiones
  primero, y dentro de ellos las más nuevas. El reparto 50/50 con
  `URL_DELETED` es una decisión tomada en PR #96 (enmienda del ADR 0004).
  Cambiarlo es solo una hipótesis: probarla con datos (las vacantes vencidas
  ya responden 410) y, si se confirma, enmendar el ADR antes del código.
- IndexNow (Bing). También sirve para GEO: ChatGPT Search y Copilot usan el
  índice de Bing. Hay que verificar el sitio en Bing Webmaster Tools.
- Salida: vacantes de 72 h indexadas de 1/5 a ≥3/5 en la muestra fija.

### Fase C — Páginas de intención con guardas (SEO programático)

- Ciudad × intención: «sin experiencia», «medio tiempo», «remoto»,
  «temporal/por temporada», «aprendiz SENA», «fin de semana». Solo donde los
  datos lo soporten (clasificador real, nada inferido sin evidencia).
- Hubs de municipios con demanda medida: Barrancabermeja, Tierralta,
  Envigado, Itagüí, Soacha, Tocancipá/Zipaquirá; en VE Puerto Ordaz, Maturín,
  Nueva Esparta.
- Guardas contra contenido delgado: mínimo de vacantes activas (p. ej. ≥10),
  noindex automático por debajo, canonical propio, entrada en
  `sitemap-categories.xml` solo si es indexable.
- Salida: impresiones y clics en esas consultas en el checkpoint +14 d.

### Fase D — AEO/GEO: que las IA y los fragmentos citen a BuscoTrabajo

- En los hubs (que ChatGPT ya cita), bloques de respuesta corta calculados con
  datos reales: cuántas vacantes activas hay hoy, empresas que más publican,
  reparto por modalidad y salario publicado solo si hay suficientes datos. Con
  fecha visible de actualización.
- JSON-LD coherente (`ItemList` ya existe). El FAQ visible ayuda a los
  motores de respuesta, aunque Google ya casi no muestra resultados
  enriquecidos de FAQ.
- `llms.txt`, Content-Signal y la API pública ya existen; mantenerlos en
  sincronía (runbook agent-readiness).
- Salida: sesiones `chatgpt.com` y de otros asistentes, y registros que
  traen.

### Fase E — Conversión y retorno (sin tocar el registro obligatorio)

- Snippets con CTR bajo en posiciones 1–3 (título/descripción de hubs).
- Alertas de vacantes por ciudad o rol para usuarios registrados: dan una
  razón para registrarse y para volver (marca y tráfico directo). Enviar
  correos necesita aprobación explícita y cumplir la Ley 1581.
- Medir el registro por visita en cada tipo de página antes y después de
  AdSense.

### Fase F — Difusión orgánica sin pago (repetir TikTok)

- **TikTok como canal principal de difusión.** Cadencia sostenida, en vez de
  un solo video viral:
  - responder comentarios con video (ya funcionó);
  - series por ciudad o por rol («vacantes sin experiencia en Medellín
    hoy»), con datos reales del sitio;
  - responder «¿es de pago?» y «¿por qué cuenta?».
- **Medición:** un enlace corto propio (p. ej. `buscotrabajo.co/tiktok`) que
  redirige con `utm_source=tiktok&utm_medium=social`, puesto en la bio si la
  cuenta lo permite o dicho en el video. Entra en la Fase A. Sin él, TikTok
  seguirá viéndose como Direct y como búsquedas de marca.
- Canales propios de «vacantes del día» por ciudad (WhatsApp/Telegram/X)
  enlazando a los hubs, con `utm` para medirlos.
- Enlaces de autoridad: bolsas universitarias, SENA, secretarías de
  desarrollo económico, comunidades. Nada de compra de enlaces.

### Checkpoints

12 y 26 de noviembre (F6 del plan de indexación) y semanal según la Fase A.
Comparar siempre con las cantidades de este documento.
