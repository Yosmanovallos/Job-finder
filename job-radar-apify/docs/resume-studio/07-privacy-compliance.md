# 07 — Privacy & Compliance

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

> **Esto no es asesoría legal ni una declaración de cumplimiento.** Es la
> preparación de evidencia para que un abogado en Colombia la revise antes
> del lanzamiento (§7). Nada aquí está auditado.

Fuentes (consulta 2026-11-14, a través de `research-ai-pricing-legal.md`):
Ley 1581 de 2012 en el normograma de la DIAN
(`normograma.dian.gov.co/dian/compilacion/docs/ley_1581_2012.htm`); Decreto
1074 de 2015, cap. 25 (compila el Decreto 1377 de 2013), en el normograma de
Cancillería; Circular Externa SIC 005 de 2017 (normograma de Cancillería);
Circular Externa SIC 002 de 2024 sobre IA (PDF oficial escaneado, **no se
pudo leer**: contenido solo por resumen secundario [?]).
`secretariasenado.gov.co` rechazó la conexión y `funcionpublica.gov.co` dio
error de certificado: se usaron normogramas oficiales alternos.

## 1. Situación actual del sitio [V]

- Registro con Supabase Auth; solo texto pasivo «Al crear tu cuenta aceptas
  los Términos de uso y la Política de privacidad» (`src/sections/Login.tsx:350-354`,
  `src/components/ApplyGateModal.tsx:141-150`). **No se guarda ninguna
  aceptación** ni versión.
- La política de privacidad (`src/sections/Legal.tsx:42-75`) no menciona la
  Ley 1581, habeas data, hojas de vida ni IA, y dice «Hoy no procesamos
  pagos». Habrá que actualizarla antes de lanzar.
- Único consentimiento guardado hoy: `consentPublish` de opiniones
  (`src/lib/site-feedback.ts:113`).

## 2. Aplicabilidad de las normas [V texto · P interpretación · ? abogado]

| Norma | ¿Aplica? | Por qué |
|---|---|---|
| Ley 1581 de 2012 | Sí | Tratamiento de datos personales de titulares en Colombia (CV). |
| Decreto 1074 de 2015, cap. 25 | Sí | Autorización, políticas, aviso, transmisiones. |
| Datos sensibles (Ley 1581 art. 5–6) | Evitar | El CV no necesita foto, salud, religión, etc. Se excluyen (doc 05 §2). Si el usuario los incluye, no se procesan con IA. |
| Transferencia internacional (art. 26) | Depende del contrato | Proveedor actúa como **encargado** → es **transmisión** (Dto. 1074 art. 2.2.2.25.5.1–5.2): con contrato de transmisión no se exige aviso ni consentimiento adicional. Igual se informa en la autorización. |
| Circular SIC 005/2017 (países adecuados) | Sí | EE. UU. y la UE están en la lista; **China y Singapur no**. |
| Registro Nacional de Bases de Datos | [?] | Obligadas: sociedades y ESAL con activos > 100.000 UVT y entidades públicas. Si el responsable es persona natural, en principio no; **confirmar con abogado**. |
| Circular SIC 002/2024 (IA) | [?] | Existe; no se pudo leer el PDF oficial. Revisar. |
| Ley 1480 de 2011 (consumidor) y comercio electrónico | Sí, por el pago | Información de precio, derecho de retracto, reversión del pago [?: confirmar alcance con abogado]. |
| Políticas de AdSense / editores | Sí, si hay anuncios | Sin anuncios en pantallas de login, error, formularios ni descargas (§6). |
| Venezuela | [?] | El sitio sirve VE. Fuera de alcance de este análisis; el MVP podría limitarse a CO. |

## 3. Proveedores de IA: qué exige cada opción [V términos · P viabilidad]

| Proveedor | Entrena con los datos | Retención | Ubicación | DPA | Mecanismo en Colombia | Viable |
|---|---|---|---|---|---|---|
| Gemini API **de pago** | No | «Periodo limitado» solo contra abuso | EE. UU. (Vertex: regiones us/eu/São Paulo) | Sí | Transmisión con contrato (EE. UU. adecuado) | **Sí** |
| Gemini API gratis | **Sí**, puede haber revisión humana; los términos piden no enviar datos personales | — | — | — | — | **No** |
| Vertex AI | No; caché ≤ 24 h; retención cero disponible | Mínima | Región elegible | Sí | Transmisión con contrato | Sí |
| OpenAI API | No, salvo autorización | 30 días contra abuso; ZDR con aprobación | EE. UU. | Sí | Transmisión con contrato | Sí |
| Anthropic API | No | 30 días | EE. UU. | Incorporado | Transmisión con contrato | Sí |
| Groq | [?] | ZDR activable | EE. UU. | [?] | Transmisión con contrato | Con verificación |
| Cloudflare Workers AI | No | Sin retención en inferencia estándar | [?] | — | [?] | Con verificación |
| Together | Guarda prompts por defecto (desactivable) | — | EE. UU. | — | — | Solo desactivando |
| Alibaba Model Studio (Singapur) | «Never» | Según región | Singapur | — | Autorización expresa (art. 26 a) o declaración de conformidad SIC | Riesgo alto |
| Z.ai (GLM) | Dice no guardar inputs de API | — | Singapur | — | Igual que Alibaba | Riesgo alto |
| DeepSeek | **Sí puede** | — | **China** | — | — | **No** |
| Moonshot (Kimi) | **Sí** | — | Singapur | — | — | **No** |

Conclusión [P]: el proveedor lo define primero la ley y después el precio.
Los viables sin trámites extra son los de EE. UU. con API de pago: Gemini
(pago o Vertex), OpenAI, Anthropic. Recomendación de costo en doc 05 §7.3.

Configuraciones obligatorias antes de habilitar cualquiera [P]:

1. Cuenta de pago, nunca nivel gratis.
2. DPA aceptado y archivado; contrato de transmisión con el contenido mínimo
   del Dto. 1074 art. 2.2.2.25.5.2 [?: el abogado decide si el DPA del
   proveedor basta o hace falta un anexo].
3. Retención cero o mínima activada cuando exista.
4. Región fijada (EE. UU./UE).
5. Lista de subprocesadores del proveedor archivada y revisada cada 6 meses.
6. Mínimo de datos al modelo: sin correo, teléfono ni dirección (se
   reemplazan por marcadores antes de enviar y se reponen al pintar).

## 4. Autorización y textos [P]

Separación clara de tres cosas distintas:

| Qué | Tipo | Forma |
|---|---|---|
| Tratamiento del CV con IA | **Autorización legal** previa, expresa, informada | Casilla obligatoria sin marcar en S3, con finalidades, responsable, encargado/país, derechos, enlace a la política y versión. |
| Guardar el CV en la cuenta | Autorización opcional e independiente | Casilla sin marcar. |
| Términos del servicio de pago | **Aceptación contractual** | En S12, antes de pagar: precio, qué incluye, 30 días, reembolsos, retracto. |
| Recordar plantilla, idioma | Preferencia | Ajustes; no es consentimiento. |
| Correos de marketing | Autorización opcional | Fuera del MVP; nunca premarcada. |

Finalidades (lista cerrada): (1) crear y editar la hoja de vida; (2)
compararla con vacantes que el titular elija; (3) proponer cambios de
redacción y preguntas; (4) generar el documento descargable; (5) cobrar y
facturar; (6) seguridad y prevención de abuso. **No**: venta de datos,
perfilamiento publicitario, entrenamiento de modelos, compartir con
empleadores.

Registro auditable: `rs_consents` (doc 06 §4) con versión de la política y
hash del texto mostrado. La política se versiona en el repo.

## 5. Derechos del titular y plazos [V plazos · P procedimiento]

| Derecho | Cómo | Plazo legal |
|---|---|---|
| Conocer / consultar | «Datos y privacidad → Exportar» (JSON) y correo de contacto | **10 días hábiles**, prorrogables 5 |
| Actualizar / rectificar | Editor | Inmediato; reclamo: **15 días hábiles**, prorrogables 8 |
| Suprimir | «Borrar todo» | Job ≤ 24 h; reclamo: 15 días hábiles |
| Revocar | «Revocar autorización» | Detiene IA de inmediato; ofrece borrar |
| Prueba de la autorización | Se entrega la fila de `rs_consents` | 10 días hábiles |

Se conservan tras el borrado solo: registro contable del pago (obligación
tributaria [?: plazo con contador]) y la constancia de autorización/revocación.

## 6. AdSense y anuncios [V políticas · P aplicación]

Según las políticas de Google para editores consultadas
(`support.google.com/publisherpolicies/answer/11112688`, `…/48182`,
`support.google.com/adsense/answer/1346295`): no anuncios en pantallas sin
contenido del editor (login, agradecimiento, error), no más anuncios que
contenido, cuidado con clics accidentales cerca de botones y menús.

Aplicación: **ningún anuncio** en `/hoja-de-vida/*` salvo, si acaso, en la
landing y en guías editoriales con contenido real (cómo escribir un CV para
auxiliar contable, etc.). Nada en onboarding, autorización, editor, análisis,
pago ni descarga. Esto no garantiza la aprobación de AdSense; aporta una
herramienta original, que es lo que la política de «contenido de poco valor»
echa en falta [?: Google no publica un criterio cuantitativo].

## 7. Matriz de cumplimiento

Tipo: **L** requisito legal · **S** recomendación de seguridad · **P** política de plataforma.

Artículos verificados en la investigación: Ley 1581 arts. 14, 15, 26 y
multas; Dto. 1074 arts. 2.2.2.25.5.1 y 5.2; Circular SIC 005/2017. **Los demás
números de artículo (Ley 1581 arts. 5, 6, 8, 9, 12, 17, 25; Dto. 1074
2.2.2.25.2.x y 3.x; Ley 1480) se citan de memoria y deben confirmarse** [?].
Estado: todo está **Pendiente** de implementación; «No aplica» donde corresponde.

| # | Requisito | Tipo | Norma o referencia | Control técnico | Evidencia esperada | Estado |
|---|---|---|---|---|---|---|
| C1 | Autorización previa, expresa e informada | L | Ley 1581 art. 9; Dto. 1074 art. 2.2.2.25.2.2 | Pantalla S3 bloqueante; casilla sin marcar | Fila en `rs_consents` + captura de la versión del texto | Pendiente |
| C2 | Informar finalidades | L | Ley 1581 art. 12 | Texto de S3 y política | Política versionada en el repo | Pendiente |
| C3 | Prueba de la autorización | L | Dto. 1074 art. 2.2.2.25.2.5 [?] | `rs_consents` solo-inserción | Consulta SQL de ejemplo | Pendiente |
| C4 | Política de Tratamiento de Datos | L | Dto. 1074 art. 2.2.2.25.3.1 | Página `/legal/privacidad` actualizada | Diff de `Legal.tsx` | Pendiente |
| C5 | Aviso de privacidad | L | Dto. 1074 art. 2.2.2.25.3.2–3.3 | Resumen en S3 | Captura | Pendiente |
| C6 | Datos sensibles opcionales y no requeridos | L | Ley 1581 art. 6 | Detector y exclusión (doc 05 §2) | Pruebas T-SENS (doc 09) | Pendiente |
| C7 | Consultas en 10 días hábiles | L | Ley 1581 art. 14 | Exportar + buzón + registro de solicitudes | Procedimiento escrito + bitácora | Pendiente |
| C8 | Reclamos en 15 días hábiles | L | Ley 1581 art. 15 | Igual | Igual | Pendiente |
| C9 | Supresión y revocación | L | Ley 1581 art. 8 e) | «Borrar todo», «Revocar» | Prueba E2E de borrado | Pendiente |
| C10 | Transmisión internacional con contrato | L | Dto. 1074 art. 2.2.2.25.5.1–5.2 | DPA + anexo | Contrato firmado archivado | Pendiente |
| C11 | Destino con nivel adecuado | L | Ley 1581 art. 26; Circular SIC 005/2017 | Proveedor en EE. UU./UE; región fijada | Configuración de la cuenta | Pendiente |
| C12 | Seguridad de la información | L | Ley 1581 art. 17 d) | Doc 08 completo | Informe de pruebas de seguridad | Pendiente |
| C13 | Reporte de incidentes a la SIC | L | Ley 1581 art. 17 n) | Procedimiento de incidentes (doc 08 §6) | Runbook | Pendiente |
| C14 | Registro Nacional de Bases de Datos | L | Ley 1581 art. 25; Dto. 1074 | Inscribir si el abogado confirma obligación | Constancia de la SIC | Pendiente / posible No aplica |
| C15 | IA: transparencia y gestión de riesgos | L [?] | Circular SIC 002/2024 [?] | Aviso de uso de IA; evals | Informe de evals | Pendiente (leer circular) |
| C16 | Sin entrenamiento con datos de usuarios | S | Términos del proveedor | Nivel de pago; ZDR | Captura de configuración | Pendiente |
| C17 | Minimización al modelo | S | Buenas prácticas | Marcadores de contacto | Prueba que inspecciona el payload | Pendiente |
| C18 | Información de precio y condiciones | L | Ley 1480 de 2011 [?] | Bloque de pago S12 + términos | Captura | Pendiente |
| C19 | Retracto / reversión del pago | L [?] | Ley 1480 arts. 47, 51 [?] | Política de reembolso | Texto revisado por abogado | Pendiente |
| C20 | Sin anuncios en flujos críticos | P | Políticas de editores de Google | Plantillas de `/hoja-de-vida/*` sin slots | Revisión de código | Pendiente |
| C21 | No presentar la puntuación como ATS ni garantía | P/L | Ley 1480 (publicidad engañosa) [?]; prompt maestro §E | Texto fijo | Captura | Pendiente |
| C22 | Edad mínima del proveedor (Gemini exige 18+) | P | Términos de Gemini API | Declaración de mayoría de edad en S3 [?] | Captura | Pendiente |

## 8. Para revisión del abogado antes de lanzar

1. ¿El DPA del proveedor cumple como contrato de transmisión o se necesita anexo?
2. ¿El responsable debe inscribirse en el RNBD?
3. Lectura de la Circular SIC 002/2024 y su efecto en este producto.
4. Textos de autorización, aviso, política y términos del pago.
5. Derecho de retracto en un bien digital ya descargado.
6. Edad mínima (≥ 18) y menores de edad que buscan primer empleo.
7. Tratamiento para usuarios de Venezuela.
8. Plazo de retención de 12 meses sin uso.
