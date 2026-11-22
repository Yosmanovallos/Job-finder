# 11 — JobStep a fondo: flujo por link, negocio, IA y cómo replicarlo

**Fecha:** 2026-11-21 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

Encargo del propietario (2026-11-21): entender cómo funciona y cómo gana
dinero JobStep (jobstep.io), qué modelos usa, y replicar **el mismo flujo**
«pego el link de la vacante → el CV se adapta» con la forma y el diseño de
BuscoTrabajo. Decisión previa del mismo día: modelos chinos con la mejor
relación calidad-precio (Qwen en Alibaba Cloud, región EE. UU.).

> **Datos personales.** El video de referencia muestra a una creadora de
> contenido y un CV de demostración. Ningún cuadro se guarda en el
> repositorio; las pantallas se describen en texto.

## 1. El video del 2026-11-21: la adaptación por link, pantalla por pantalla [V]

Video vertical de TikTok (`@dani.trabaja`), 57 s, 576×1024, con
subtítulos. Una creadora cuenta que la rechazaban siempre, que «alguien de
RR. HH.» le mostró JobStep y graba su pantalla. Complementa la grabación
del 2026-11-14 (doc 01), que mostraba el onboarding y el muro de pago pero
**no** la adaptación a una vacante.

**Hallazgo clave:** la barra de direcciones muestra
`…creatorprogram.io/creator/resources/demos/resume-tailor-demo?view=tailor&job=pasted-…`.
Lo que se graba **no es la app real** sino un **demo de un programa de
creadores**: JobStep (o una agencia) entrega a creadores de UGC un entorno
de demostración para grabar videos. Es un canal de adquisición pagado, no
un testimonio espontáneo (ver §3). Aun así, el demo **refleja el producto
real**: los textos de interfaz que aparecen en el HTML público de jobstep.io
coinciden con lo que se ve en el video («Where did you do this?», «Add all»,
«Your CV is tailored to this job») [V, 2026-11-21].

| # | Seg. | Pantalla | Qué pasa | Nota de diseño |
|---|---|---|---|---|
| 1 | 0–14 | Gancho | «¡Al de RR. HH. que me enseñó esto…!» sobre una lista de correos «Solicitud de empleo / Rechazo». | Formato UGC: dolor → descubrimiento → demo → resultado. |
| 2 | 24–26 | Modal «Añadir un nuevo empleo» | «Pega el enlace de una oferta de empleo; extraeremos los detalles automáticamente». Campo «Enlace de la oferta» con etiqueta **«Recomendado»**; pega un link de **LinkedIn** (`linkedin.com/jobs/view/…`). Botones «Añadir empleo» / «Cancelar». | El link es la entrada principal. Hay validación visual (check verde). |
| 3 | 28 | Tablero «Tus solicitudes» | Pestañas «Seguimiento» y «Documentos». Columnas tipo kanban «Solicitado» (9) y «Entrevista» (10) con tarjetas (cargo, empresa, «hace 3 días», «Reciente», «Ronda 1»), y una tarjeta que pregunta «¿Cómo fue la entrevista?». | El CV adaptado vive dentro de un **tracker de postulaciones**: retención más allá de un solo CV. |
| 4 | 30 | «Selecciona tu CV» | «Elige el CV que quieres usar como base para tu candidatura». Una tarjeta con el CV base y su fecha. «Continuar». | Un CV base, muchas adaptaciones. |
| 5 | 32–34 | Puntuación inicial | Anillo **«36 · Sólido»**, «Puntuación de coincidencia con el empleo», sobre la vista previa del CV (con foto). | La cifra baja inicial crea la necesidad. |
| 6 | 36 | Chat, paso 1 | Pestañas **Chat / Estilo**. Mensaje: el CV para *Junior Marketing* en la empresa empieza por arriba; propone cambiar el **título del perfil** a uno alineado con la oferta. Tarjeta «Actualización de datos personales» con el texto propuesto y botones **«Editar» / «Aceptar»**. | Una propuesta por tarjeta; el usuario decide. |
| 7 | 38–40 | Chat, paso 2 | «Actualización de datos personales aprobada». Luego: herramientas que ya están en tu CV cubren parte de la oferta; faltan otras: **«Elige únicamente aquellos con los que ya tengas experiencia real»**. Lista de habilidades con casillas y **«Añadir todo»**. Resultado «Añadido». | La IA **no agrega** habilidades: el usuario marca solo las reales. |
| 8 | 40 | Chat, paso 3 | «Antes de reescribir nada, dime en qué prácticas hiciste lo siguiente. Te marco lo que veo en tu currículum; cámbialo si hace falta.» Tarjeta **«¿Dónde hiciste esto? · Engagement y conversión · 2/4»** con las experiencias del CV como casillas (la IA pre-marca una). | Mapeo **requisito → experiencia** confirmado por el usuario, uno por uno (1/4…4/4). |
| 9 | 42 | Chat, paso 4 | El usuario escribe lo que hizo («Ayudé a configurar pequeñas campañas en Instagram y TikTok con presupuesto limitado y analicé los resultados»). La IA responde y propone **«Actualizar elemento de la sección Experiencia laboral»** con la viñeta reescrita, **resaltada en verde**, y la razón («es un requisito obligatorio; por eso va en primer lugar»). «Editar» / «Aceptar». | La cifra y el hecho vienen del usuario; la IA redacta y reordena. |
| 10 | 44–46 | Cierre del chat | Varias «Actualización de elemento aprobada». Resumen: «Tu currículum ahora habla el idioma de *Junior Marketing*» con la lista de cambios; **«CV está adaptado a este puesto · Puntuación de coincidencia con el empleo: 75»**. Botón «Continuar» «para finalizar y descargar». | Cierre con antes/después numérico (36 → 75). |
| 11 | 48 | Editor | Pestañas Editor / Estilo; medidor **«96 · Excelente»**, «Descubrir JobStep.io Score». | Segundo puntaje (calidad general del CV), distinto del de coincidencia. |
| 12 | 50 | CV final | Vista del documento: viñetas con verbos y cifras, experiencia reordenada. | |
| 13 | 52–57 | Cierre UGC | «Gente, esto es una locura», «esto no es asesoramiento financiero». | |

### 1.1 El patrón del agente, resumido [V → P]

Lo que hace que se sienta «agéntico» no es que el modelo navegue solo, sino
un **guion fijo de pasos** que el chat recorre con tarjetas de acción:

1. **Título/encabezado** alineado con la oferta → Editar/Aceptar.
2. **Habilidades faltantes** → casillas, el usuario marca solo las reales.
3. **Por cada requisito importante (N de M):** «¿dónde hiciste esto?» con
   las experiencias como opciones → el usuario confirma o escribe → la IA
   reescribe la viñeta (diff en verde) → Editar/Aceptar.
4. **Reordenar** experiencias y viñetas según la oferta.
5. **Resumen** de cambios + puntuación nueva → Continuar → descarga (pago).

Esto es justo el pipeline determinista que pide AGENTS.md (reglas 4 y 12):
el **código** decide los pasos y el orden; el **LLM** solo redacta,
extrae y propone dentro de cada paso, con salida JSON validada.

## 2. Quién es JobStep y qué vende

Fuentes consultadas el 2026-11-21 por tres agentes de investigación (solo lectura web).
Etiquetas: **[V]** fuente primaria, **[código]** texto de interfaz en el HTML público
(existe, puede ser variante A/B), **[3º]** terceros, **[inf]** inferencia nuestra.

### 2.1 Empresa

- Aviso legal: «JobStep, c/o M. Brenner, Weinbergstrasse 45, 8006 Zürich»,
  sin forma jurídica [V `jobstep.io/en/impressum`].
- Entidad probable: **TenThirty GmbH** (CHE-167.324.376), Zúrich, constituida
  en abril de 2025 con CHF 20.000 de capital; tres socios-gerentes con un
  tercio cada uno (Max Brenner, Alexander Eichhorn, Jan-Oliver Seidenfuss);
  misma dirección que el aviso legal desde 2026-05-22 [V Zefix · vínculo con
  la marca: inf]. Product Hunt: lanzado en 2026 [V].
- **Ojo con las fechas:** la política de privacidad y la de reembolsos de
  JobStep están fechadas el **2025-01-15**, antes de que existiera
  TenThirty. Es decir, el producto **es anterior** a esa sociedad. El
  dominio del backend (`backend.careerarc.ai`) sugiere una marca o entidad
  previa. El vínculo con TenThirty es probable pero no está probado, y «lanzado en
  2026» (Product Hunt) es solo la fecha del lanzamiento en esa plataforma.
- Equipo pequeño; sin financiación pública conocida [no verificado]. Opera en ~30 idiomas, con producto hermano
  InterviewStep.io.

### 2.2 Producto [V salvo indicación]

| Función | Gratis | Pago |
|---|---|---|
| Puntuación general del CV («JobStep Score», 0–100, por secciones) | ✅ | |
| Crear CV con IA, 8 plantillas, traducir el CV | ✅ | |
| Tracker de postulaciones (Preparación / Postulé / Entrevista) | ✅ | |
| **Adaptar el CV a una oferta desde el link** (el flujo del video) | | ✅ |
| Cartas de presentación desde el link | | ✅ |
| **Descargar** (solo PDF; DOCX solo como entrada) | | ✅ ilimitado |
| Sugerencias diarias de vacantes con % de match | parcial | ✅ (no en todos los países) |

- No hay autopostulación, ni extensión de Chrome, ni apps móviles.
- Dos puntajes distintos [código]: **Job-Match** (qué tan bien encaja con la
  oferta: título, habilidades, experiencia, legibilidad; «desde ~55 eres
  competitivo») y **JobStep Score** (calidad general). Fórmula no publicada.

### 2.3 Precios

**La moneda depende de la IP** del visitante.

| Mercado | Mensual | Trimestral | Fuente |
|---|---|---|---|
| Colombia (COP) | 18.900 | 12.300/mes (36.900 cada 3 meses, «−35 %») | [V] jobstep.io/es, 2026-11-21 |
| EE. UU. (USD) | 24,95 | 11,95/mes («−52 %») | [3º] Toolvori, 2026-10-17 |
| Europa (EUR) | ~19,99–24,95 | 9,95/mes | [3º] fragmentos contradictorios |

- También hay planes de 6 y 12 meses [código]. No hay plan semanal.
- **Renovación automática** «hasta que se cancele», con pago por Stripe [V términos].
- Hay infraestructura para **pruebas de pago que se convierten en suscripción**
  («Switch to {days}-day trial · Then {price}, renews automatically»),
  descuentos solo en el primer periodo y un temporizador
  «reservado por {minutes} minutos» [código].
- **Reembolso** [V `/en/refund`]: 7 días solo en la primera compra. **Se pierde
  si descargaste un CV**, si adaptaste uno o si seguiste más de 10 empleos.
  Como lo que se paga es descargar, la «garantía del 100 %» casi nunca aplica [inf].
- **Baja** [código]: más de 8 pantallas de retención, en este orden: motivo,
  «elige un precio justo», descuento, «recuérdame», plan anual, pausa,
  llamada de 15 minutos, mes gratis, y por último «cancelar».
- «532 personas eligieron este plan en 24 h» es **texto fijo** en el código,
  no un dato real.

## 3. Cómo gana dinero (motor de crecimiento)

1. **Fábrica de videos UGC (`creatorprogram.io`, operado por JobStep)** [V]:
   recluta creadores sin seguidores, les **abre cuentas nuevas** de TikTok,
   les da **guiones** y les pide **1 video al día** grabado sobre un **demo**
   (es lo que se ve en el video del §1). Pago fijo mensual con factura, hasta
   «3k €/mes» y bonos por vistas. Sus anuncios en Meta (~74 activos) son en
   su mayoría para **reclutar creadores** en MX, RD, CR, GT, PA, UY, BR, FR
   y FI. La cuenta oficial de TikTok tiene solo ~3.300 seguidores: **el
   alcance viene de la red de cuentas de creadores** [inf].
2. **Afiliados (Rewardful)**: 50 % de la primera compra (~13 €, lo que implica un
   ticket medio inicial de ~26 €), cookie de 30 días [V `/en/affiliate`].
3. **SEO en ~30 idiomas** (Similarweb: 76 % del tráfico de búsqueda es
   orgánico) + píxeles de TikTok, Meta y Google Ads para retargeting [V privacidad].
4. **Monetización**: precio alto en EUR/USD frente a un costo de IA de
   centavos, **renovación automática**, descuentos solo en el primer periodo,
   **reembolsos casi imposibles** y un **flujo de baja largo**. La retención
   es en gran parte **fricción**, no valor.

**Tracción.** Similarweb estima **~1,3 M de visitas en 3 meses**
(~430 mil al mes, +24 % mes a mes), sobre todo de Brasil, Francia, Alemania,
México e Italia. Trustpilot muestra 3.283 reseñas, el 85 % de 5★. El código
solo pide reseña al usuario que marca «encontré trabajo» al cancelar [código].
No hay cifra pública de ingresos.

**Orden de magnitud de ingresos [inf, ilustrativo, no es un dato].**
Supuestos: ~430 mil visitas al mes, entre 0,5 % y 2 % compra y ~26 € de primera
compra. Resultado: **~55 mil a ~225 mil € al mes** solo en primeras compras,
más las renovaciones. El rango es muy amplio porque la conversión real se
desconoce.

**El lado oscuro (por qué no se copia tal cual).** Hay reseñas de 1★ de
septiembre a noviembre de 2026 en Perú, Polonia, Noruega, Alemania, Grecia
y Dinamarca: no pueden cancelar, cobros recurrentes «ocultos», reembolso
negado por haber descargado y una llamada obligatoria de 15 minutos para el
reembolso [V Trustpilot].

## 4. Qué IA usa y cuánto le cuesta

- **Modelos:** OpenAI **GPT-5** (privacidad, 2025-01-15) y **Anthropic Claude**
  (página de seguridad, 2025-11-13), sin entrenamiento según sus acuerdos [V].
- **Leer el link:** en el **servidor**, con **Firecrawl** («extrae el
  contenido de ofertas en webs de empleadores») y **Exa.ai** («scrapea
  ofertas públicas»), ambos en EE. UU. [V privacidad]. Si falla, muestra
  «The job link couldn't be opened!» y un formulario para **pegar la
  descripción** [código]. No hay evidencia de cómo resuelve LinkedIn, cuyos
  términos (§8.2) prohíben extraer con scripts, bots, *plugins* o *add-ons* [V].
- **Infraestructura:** Vercel, Railway/AWS UE (Postgres), Cloudflare R2,
  Firebase Auth, Stripe, PostHog, Sentry [V].
- **Costo de IA por adaptación:** no se publica. Con el presupuesto de
  tokens de §5.4 (~63 mil de entrada y ~10,5 mil de salida) y gpt-5-mini
  (0,25/2,00 USD por millón), serían **~USD 0,04**. El precio de GPT-5
  completo no está verificado en nuestra investigación. Firecrawl/Exa
  agregan un costo por página no verificado. **Frente a ~20 € de ticket, la
  IA es menos del 1 % del precio** [inf].

**Conclusión:** JobStep no gana por la IA (que es casi gratis), sino por
**distribución barata y masiva (UGC con cuentas nuevas + afiliados al 50 %)**
y por **retener con fricción**. Lo replicable y legítimo es lo primero y
el producto. Lo segundo no.

### 4.1 Nuestra economía con la misma lógica (Qwen en EE. UU.) [P]

Costo por adaptación con el presupuesto de §5.4:

| Mezcla | USD | COP (TRM 4.000, supuesta) |
|---|---|---|
| Todo qwen3.7-flash (0,03/0,13) | ~0,003 | ~13 |
| Flash + qwen3.7-plus en las 4 reescrituras | ~0,011 | ~45 |
| Peor caso (×3 tokens) | ~0,033 | ~130 |

Caché de contexto de Alibaba [V, 2026-11-21]: con caché implícita, un acierto
cuesta ≈ 20 % del precio de entrada; con explícita, ≈ 10 %. Así el CV base
repetido en cada tarjeta sale casi gratis.

**Margen por venta** (Wompi 2,65 % + COP 700 + IVA; IVA 19 % si aplica;
reserva del 3 %; 30 usuarios gratis por cada pago a ~COP 45 cada uno; peor
caso de COP 130 por adaptación):

| Plan | Precio | Queda antes de IA | Uso típico: 10 adapt./mes × COP 45 + gratis | Margen típico | Peor caso: tope de 30/mes × COP 130 + gratis | Margen en el peor caso |
|---|---|---|---|---|---|---|
| Pase 1 mes | 14.900 | 10.771 | −450 −1.350 | **8.971 (60 %)** | −3.900 −1.350 | 5.521 (37 %) |
| Pase 3 meses | 29.700 | 22.297 | −1.350 −1.350 | **19.597 (66 %)** | −11.700 −1.350 | 9.247 (31 %) |

Sin IVA (si el contador confirma que no eres responsable), cada venta deja
COP 2.379 (1 mes) o 4.742 (3 meses) más.

Mismo producto que JobStep en Colombia, **~20 % más barato**
(18.900 / 12.300 de ellos frente a 14.900 / 9.900 nuestros) y con margen sano.

## 5. Réplica en BuscoTrabajo: mismo flujo, nuestro diseño [P]

### 5.1 Pantallas (design system de buscotrabajo.co, prototipo rev. 3)

| JobStep | BuscoTrabajo | Cambio respecto al prototipo del 14-nov |
|---|---|---|
| Modal «Añadir un nuevo empleo» con link | **«Adaptar mi hoja de vida a una vacante»**: campo «Pega el link de la vacante» + pestaña «Pegar el texto». También entra desde el botón ✦ de cada vacante del sitio (link ya resuelto). | **Nuevo**: entrada por link externo. |
| «Selecciona tu CV» | «Tu hoja de vida base»: elegir una guardada o subir PDF/DOCX (con las 3 casillas de autorización la primera vez). | Igual que rev. 2, con selector de base. |
| Anillo «36 · Sólido» | «Compatibilidad estimada» con desglose (fórmula pública, doc 05 §4). | Igual. |
| Chat con tarjetas Editar/Aceptar | Agente con tarjetas **Aplicar / Editar / Omitir**, paso «N de M», diff en verde. | Se añade el guion de 5 pasos de §1.1. |
| «¿Dónde hiciste esto? 2/4» | «¿Dónde demostraste *{requisito}*?» con tus experiencias como opciones + «En ninguna» + «Lo hice en otro lugar». | **Nuevo** tipo de tarjeta (`requirement_mapping`). |
| Habilidades con «Añadir todo» | Casillas **sin** «Añadir todo»: hay que marcar una por una. | Más estricto contra datos inventados. |
| Resumen 36 → 75 + Continuar | Resumen con antes/después y lista de cambios → pantalla de pase. | Igual. |
| «JobStep.io Score 96» | «Calidad de tu hoja de vida» (legibilidad/estructura, código, sin «ATS»). | Segundo puntaje, solo determinista. |
| Tablero «Tus solicitudes» | **«Mis postulaciones»**: columnas Guardada / Postulé / Entrevista / Oferta / Descartada, cada tarjeta con su CV adaptado. | **Nuevo**, fase R4b; da retención mensual al pase. |

**Prototipo navegable:** [`mockups/resume-tailor-link-prototype.html`](mockups/resume-tailor-link-prototype.html)
(datos sintéticos, sin IA real). Recorre las pantallas link (incluido el
caso LinkedIn → pegar texto), CV base, agente con tarjetas, pase y
postulaciones. El puntaje se calcula en el navegador con la fórmula del doc 05
(simplificada): en el recorrido de prueba sube de **33 a 83** con 6 cambios
aprobados, y cada viñeta sale solo de la respuesta del usuario. Probado el
2026-11-21 a 1024 px y a 375 px (en móvil, pestañas «Agente / Tu hoja de vida»).

### 5.2 Motor: máquina de estados, no agente libre

```
link ─► resolver (código) ─► vacante normalizada (JobSnapshot)
                                   │
CV base (facts con source_span) ───┤
                                   ▼
 S1 requisitos      LLM flash → JSON {requirements[{id,text,kind:must|nice,skills[]}]}
 S2 evidencia       LLM flash → JSON {req_id → [{fact_id, quote}]}; código verifica cada quote
 S3 puntaje         código (doc 05 §4)  → 36
 S4 guion           código arma la cola de tarjetas:
                      headline → skills_missing → requirement_mapping×N (máx 4–6) → reorder → summary
 S5 por tarjeta     LLM redacta propuesta (rewrite usa SOLO facts citados + respuesta del usuario)
                    validador de factualidad (código) → si aparece un dato nuevo: se descarta o pasa a pregunta
 S6 puntaje final   código → 75; resumen
```

- El **usuario** avanza la cola; el modelo nunca decide qué URL visitar ni
  repite llamadas por su cuenta. Cada tarjeta = **1 llamada** (máx. 2 con
  reintento por JSON inválido).
- **Chat libre** («hazlo más corto», «en inglés no») permitido solo dentro
  de la tarjeta activa, con tope de turnos por adaptación (p. ej. 8).
- Prompts versionados con esquema JSON, presupuesto de tokens y pruebas
  adversariales (AGENTS.md regla 11). La vacante y el CV van entre
  delimitadores como **datos**, nunca instrucciones.

### 5.3 Resolver de links (orden fijo, AGENTS.md §Source priority)

1. `buscotrabajo.co/...` → vacante de nuestra base.
2. ATS con API pública (Greenhouse, Lever, Ashby, SmartRecruiters, …) → API.
3. Otro sitio → `GET` del HTML con controles SSRF (bloqueo de IPs privadas
   y de metadatos, revalidar cada redirección, ≤ 2 MB, 8 s, solo
   `text/html`) → `JobPosting` JSON-LD → si no hay, texto principal
   recortado → LLM flash lo convierte a JobSnapshot.
4. **LinkedIn**, sitios con login o anti-bot → no se descarga nada:
   - se detecta el dominio y la URL se guarda en la tarjeta del tracker
     (el link sigue sirviendo para «Ir a la vacante»);
   - una sola pantalla: «Copia la descripción de la vacante y pégala
     aquí», con el campo enfocado y una guía de 2 pasos (en móvil:
     «Compartir → Copiar»);
   - con el texto pegado, se intenta encontrar **la misma vacante** (empresa
     + cargo) en nuestra base y en las APIs de ATS, porque muchas vacantes
     de LinkedIn también están publicadas ahí. Si aparece, se usa esa
     versión estructurada.
   (Ver §6: LinkedIn §8.2 lo prohíbe.)
5. Cache por URL canónica (24 h) para no pagar dos veces la misma vacante.

### 5.4 Presupuesto de tokens por adaptación (supuesto de diseño, se mide en R3)

| Paso | Llamadas | Entrada | Salida | Modelo |
|---|---|---|---|---|
| Vacante → JSON (si no hay JSON-LD) | 1 | 4.000 | 1.000 | qwen3.7-flash |
| S1 requisitos | 1 | 4.000 | 1.500 | qwen3.7-flash |
| S2 evidencia | 1 | 7.000 | 2.000 | qwen3.7-flash |
| S5 tarjetas (título, habilidades, 4 requisitos, reorden, resumen) | 8 | 24.000 | 4.000 | flash; plus para las 4 reescrituras |
| Chat libre dentro de tarjetas (tope) | ≤ 8 | 24.000 | 2.000 | qwen3.7-flash |
| **Total por adaptación** | **≤ 19** | **~63.000** | **~10.500** | |

El CV base se extrae **una sola vez** (≈ 4.000 / 2.500) y se reutiliza en
todas las adaptaciones.

## 6. Copiar, adaptar, no copiar

| De JobStep | Decisión | Por qué |
|---|---|---|
| Flujo link → CV base → puntaje → guion de tarjetas → 36→75 → descargar | **Copiar** (§1.1, §5) | Es el producto. |
| Dos puntajes (coincidencia y calidad) | **Copiar**, pero con fórmula pública y sin «ATS» | RS-P4. |
| Tracker de postulaciones gratis | **Copiar** (fase R4b) | Retención legítima, por valor. |
| Gratis hasta el final y pagar para descargar | **Copiar** | Ya está en el diseño. |
| Leer links en el servidor (Firecrawl/Exa) | **Adaptar**: fetch propio con controles SSRF solo para sitios que lo permiten; **LinkedIn y sitios con login → pegar el texto** | LinkedIn §8.2 prohíbe extraer con scripts, bots, *plugins* o *add-ons*; caso hiQ v. LinkedIn (2022): sus términos son exigibles. AGENTS.md regla 8. |
| GPT-5/Claude en EE. UU. | **Adaptar**: Qwen en Alibaba Cloud, Virginia, alcance «US» | Decisión del propietario. Alibaba no entrena sin consentimiento aparte; guarda prompts **hasta 30 días** (ZDR solo enterprise); DPA con SCC [V `alibabacloud.com/help/en/model-studio/data-retention-policy`, `/help/en/legal/latest/fe2cxg`]. |
| Videos UGC con guion + programa de creadores | **Adaptar**: creadores colombianos, con publicidad **declarada** (#publicidad / «contenido pagado»), grabando el producto real | Video UGC en Colombia: ~COP 90–100 mil (principiante) a ~USD 150 [3º]. La SIC exige que la publicidad con influenciadores sea identificable [?: confirmar su guía vigente]. |
| Afiliados al 50 % de la primera compra | **Adaptar**: 30 % **del precio sin IVA**, solo en el pase de 3 meses (≈ COP 7.490) | Con nuestro ticket, el 50 % casi no deja margen. Aun al 30 %, en el peor caso (90 adaptaciones con el costo máximo) quedarían ~COP 1.750: el cupo de adaptaciones tiene que cumplirse. |
| Renovación automática | **Decidido por el propietario (2026-11-21): pases de pago único, sin renovación automática.** Se reevalúa solo después del lanzamiento y con datos. Si se agrega: Wompi «fuentes de pago» (tarjeta, Nequi, Botón Bancolombia), aviso antes de cada cobro y **cancelar con 1 clic** | Ley 1480 art. 43-14: es abusiva la renovación que impida terminar en cualquier momento [V]. Wompi no trae motor de suscripciones: el cobro periódico lo programamos nosotros [V docs Wompi]. |
| Temporizador «reservado por N minutos», cifra fija «532 personas» | **No copiar** | Información engañosa (Ley 1480 arts. 23 y 29–30); RS-P7. |
| Reembolso que se pierde al descargar; llamada obligatoria | **No copiar**. Retracto según la ley (5 días hábiles; devolución en 15 días calendario según la Ley 2439 de 2024), con consentimiento expreso de inicio inmediato si se usa la excepción del art. 47 | [V Ley 1480; Ley 2439/2024; ?: validar con abogado, incluida la C-192/26]. |
| Baja con 8+ pantallas de retención | **No copiar**: una pantalla de confirmación (y como máximo una oferta) | Art. 43-14; quejas en Trustpilot. |
| Pedir reseña solo a quien «encontró trabajo» | **No copiar** | Reseñas sesgadas. |

## 7. Embudo de adquisición propio [P]

1. **Ventaja que JobStep no tiene:** ~miles de vacantes propias en
   BuscoTrabajo. El botón ✦ «Adaptar mi hoja de vida» en cada vacante es
   tráfico de intención ya pagado por el SEO actual.
2. **Contenido UGC:** 3–5 creadores colombianos al mes, grabando el
   producto real (no un demo), guiones con datos verificables, etiqueta de
   publicidad. Presupuesto de prueba: ~COP 0,5–1 M/mes.
   **Equilibrio:** a ~COP 9.000 de margen por pase mensual, un video de
   COP 100 mil se paga con **~11 ventas**. Se mide con un código o link por creador.
3. **Afiliados** (orientadores, bootcamps, influencers de empleo): 30 % del
   pase de 3 meses.
4. **SEO:** landing `/hoja-de-vida` + guías (ya ligado al plan de AdSense).

Referencias de conversión [3º RevenueCat 2026, apps móviles, no web]:
- **Pago duro vs. freemium:** el pago duro convierte un 10,7 % frente al
  2,1 % del freemium.
- **Prueba → pago:** 25–43 % según lo que dure la prueba.
- **Retención:** la de los suscriptores mensuales de apps de IA es baja (≈ 9–12 % a 12 meses).
- **En este rubro el churn es estructural:** el usuario se va cuando consigue empleo. Por eso conviene el pase trimestral.

## 8. Plan de implementación actualizado (local + sandbox, nada a `main`) [P]

| Fase | Contenido | Criterio de salida |
|---|---|---|
| **R0** | ADR de implementación; especificación de este doc; resolver el D2 (precios); rebase de la rama | Textos aprobados |
| **R1** | Tablas `rs_*` (contenedor desechable), CV base: subir/extraer/confirmar, 3 plantillas, vista previa | Pruebas de archivo e IDOR en verde |
| **R2** | Resolver de links (§5.3) + pegar texto; JobSnapshot; caché por URL | 30 links reales (CO: Computrabajo, Elempleo, Magneto, ATS, sitios de empresas) → % resuelto sin LLM medido; SSRF en verde |
| **R3** | Alibaba (verificado 2026-11-21 en `model-studio/base-url`, `regions` y `usa-virginia-global`): el alcance se elige **por workspace** (crear un workspace en Virginia con alcance «United States (inference within the region)»); la API key es de ese workspace; el endpoint compatible con OpenAI es `https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1` (timeout de 3600 s). **qwen3.7-flash no aparece en la página de modelos** (sí qwen3.8-flash y qwen3.7-plus): confirmar en la consola us-east-1; si no está, el modelo por defecto es qwen3.8-flash (0,15/0,47, ~USD 0,014 ≈ COP 58 por adaptación sin caché). Después: gateway Qwen (alias, topes por sesión/usuario/día/mes, interruptor), máquina de estados §5.2, tarjetas Aplicar/Editar/Omitir, `requirement_mapping`, validador de factualidad, dos puntajes | 20 CV sintéticos × 10 vacantes: 0 hechos inventados aceptados; costo medido ≤ COP 150 por adaptación; latencia por tarjeta < 5 s p50 |
| **R4** | Wompi sandbox: pases 1 y 3 meses, H1/H2 corregidos, `rs_entitlements`, cupos de adaptaciones | Pago aprobado, rechazado, duplicado y reembolso probados |
| **R4b** | «Mis postulaciones» (tracker) | Flujo completo vacante → CV → postulé → entrevista |
| **R5** | Un solo merge aprobado | — |

> **R1 cerrada con alcance ajustado (2026-11-21):** CV base creado y editado a mano, sin subida ni extracción. Subir PDF/DOCX, extraer con `source_span` y T-FILE pasan a un cambio posterior (antes de R3); D6 sigue abierta. Ver [`openspec/changes/archive/resume-studio-r1/`](../../openspec/changes/archive/resume-studio-r1/proposal.md).

> **R2 cerrada (2026-11-21):** subida PDF/DOCX → texto (T-FILE-1..8) y resolver de links (§5.3) con controles SSRF, `JobSnapshot` y caché de 24 h. Muestra de 30 links reales: **63,3 % sin LLM** en el peor caso (62,1 % sin el único link leído por la API de SmartRecruiters, que ahora va por la web; Elempleo 8/8, Magneto 6/6, portales oficiales 5/8, Computrabajo 0/8 registrado como muro de login). Ver [`openspec/changes/archive/resume-studio-r2/`](../../openspec/changes/archive/resume-studio-r2/validation.md).

Decidido el 2026-11-21: **pases sin renovación automática**; se empieza R0.
Pendiente del propietario: capturas del precio de la prueba de JobStep
(las consigue él). Decisiones abiertas: D2 precio final (propuesta
14.900 / 29.700 + pase de 7 días a 6.900); % de afiliados; presupuesto de UGC; abogado (retracto, autorización,
publicidad con influenciadores); contador (IVA, factura electrónica).

## 9. Fuentes principales (consultadas el 2026-11-21)

jobstep.io: `/es`, `/en`, `/en/privacy`, `/en/security`, `/en/terms`,
`/en/refund`, `/en/impressum`, `/en/affiliate`, `/en/resume/ats-checker` ·
Zefix: TenThirty GmbH (firm/1690099) · Product Hunt: `products/jobstep/makers` ·
`creatorprogram.io` · Meta Ad Library (q=jobstep.io) · Trustpilot
(`review/jobstep.io`) · Similarweb (`website/jobstep.io`) · Toolvori
(2026-10-17) · LinkedIn User Agreement (vigente desde 2025-11-03) ·
Proskauer/ZwillGen sobre hiQ v. LinkedIn · Google `JobPosting` docs ·
Wompi `docs.wompi.co/docs/colombia/fuentes-de-pago/` y
`wompi.com/es/co/planes-tarifas/` · Ley 1480 de 2011 (Función Pública) ·
Ley 2439 de 2024 · RevenueCat State of Subscription Apps 2026 · Alibaba
Cloud Model Studio: `model-pricing`, `context-cache`, `regions`,
`data-retention-policy`, DPA · Story Talent / Somos Itera (costo de UGC en Colombia).
