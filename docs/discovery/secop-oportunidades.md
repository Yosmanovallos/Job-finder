# SECOP → Notion "Oportunidades" — guía operativa

Puente de descubrimiento que lleva licitaciones públicas de QA/AI de **SECOP II**
(Colombia Compra Eficiente, datos abiertos) a una base Notion dedicada,
**separada** de la base curada "Vacantes". Implementado 2026-07-19.

## Qué hace

1. Consulta la **Socrata Open Data API** de `datos.gov.co` (dataset `p6dx-8zbt`),
   sin login, sin evadir controles (API pública, licencia CC BY-SA). Ver
   `docs/source-catalog/secop.md`.
2. Filtra procesos `Publicado`/`Abierto` cuya descripción contiene términos
   QA/AI (pruebas de software, automatización de pruebas, calidad de software,
   inteligencia artificial, machine learning, testing, …) publicados en la
   ventana reciente (por defecto 60 días).
3. **Filtra a persona natural / contratista independiente** (ver sección
   dedicada): solo contratos de servicio que tú puedes prestar solo.
4. Mapea cada proceso a una `Opportunity` (sin inventar campos ausentes:
   presupuesto/ciudad/URL quedan `null` si la fuente no los declara).
5. Crea/actualiza páginas en la base Notion **"Oportunidades (SECOP)"** (bajo la
   página "radar de empleo"), con idempotencia por archivo — re-correr no
   duplica. Las páginas de corridas previas que ya no pasan el filtro se
   **archivan** (a la papelera de Notion, reversible) y se quitan del estado.

## Filtro de persona natural (independiente)

Tú no tienes empresa: ofreces servicio de testing como persona natural. El
puente deja **solo** oportunidades que puedes tomar solo:

- **Discriminador principal — `tipo_de_contrato`**: se conservan
  `Prestación de servicios` y `Consultoría`. Eso excluye por diseño bienes
  (Compraventa/Suministros), obra, y los convenios de régimen especial con
  entidades sin ánimo de lucro (Decreto 092 de 2017 — una persona natural no
  puede ser parte).
- **Exclusión de modalidades de gran escala** (refuerzo): `Licitación pública`,
  `Selección abreviada`, `Subasta inversa`, `Concurso de méritos`/`Acuerdo
marco`, `Enajenación` — que en la práctica solo gana una empresa.
- **Se excluyen procesos ya adjudicados o cerrados**: `adjudicado != 'Si'` y
  `estado_de_apertura_del_proceso != 'Cerrado'`. Esto ataca directamente la
  preocupación de `guia_busqueda_secop_independiente.md` (que régimen especial
  "suele estar ya adjudicado") **sin** botar la modalidad. Se usa `!=` para
  conservar filas con el campo vacío (desconocido ⇒ se mantiene).
- **Se excluyen procesos con proveedor ya contratado** (crítico): las entidades
  de régimen especial publican contratos YA FIRMADOS solo por transparencia
  ("módulo publicitario", Ley 2195 art. 53). En esos, `adjudicado` sigue en `No`
  pero `nombre_del_proveedor`/`nit_del_proveedor_adjudicado` traen un proveedor
  real (los abiertos dicen `"No Definido"`). Se descartan (no se puede aplicar).
  Detectado gracias a un caso real (proc. 196-2026, ya adjudicado a ETERIUX
  SOLUTIONS, que se colaba con `adjudicado = No`).
- **Se mantiene `Contratación régimen especial`** (desviación consciente de la
  guía, que pide excluirla): ahí vive el grueso de los contratos individuales de
  prestación de servicios (universidades/entidades de régimen especial
  contratando personas). Excluirla dejaría fuera ~27 de 30 procesos abiertos y
  no adjudicados. En su lugar se filtra la adjudicación directamente (arriba).
- **Categoría UNSPSC como señal de precisión (no gate duro)**: se leen los
  códigos `codigo_principal_de_categoria`; los de servicios TI del catálogo de la
  guía (familias `8111xx`, `801116`, `801015/17`) **rescatan** una mención IA
  suelta y suben la relevancia. Pero un código no-TI **no descarta** por sí solo:
  SECOP miscodifica trabajo real de "desarrollo de software" bajo categorías de
  marketing/hardware/bienes, así que un gate duro borraría leads reales
  (verificado en los datos). El código se muestra en Notion.
- **Se descarta el ruido de "solo mención de IA"**: si no hay término QA/dev, ni
  contexto de servicio técnico, ni código UNSPSC de TI → se descarta (agrícola,
  audiovisual, editorial, capacitación que solo nombran "inteligencia
  artificial").
- **Consultoría nunca es "Alta"** (suele adjudicarse a firmas, no a un
  independiente); se marca "Media".
- **No se filtra por las skills del perfil** (`config/profile.local.yaml`): sus
  must-have están en inglés ("Manual Testing") y SECOP es en español, así que
  se usa la red propia de keywords QA en español, no el motor de matching.
- **Tope de presupuesto $150M COP** (línea de red-flag de la guía: <$80M típico
  de persona natural, >$100M casi siempre persona jurídica). Un `precio_base` sin
  declarar (0 ⇒ `null`) se considera desconocido, no grande, y se conserva. Ojo:
  en régimen especial `precio_base` a veces es el valor total del programa, no el
  del contrato individual — señal ruidosa, por eso la línea es generosa ($150M) y
  no $80M. El monto se muestra para que lo juzgues tú.

> Nota: la heurística de keyword aún deja algún falso positivo en "Alta" que
> coincide por el nombre de un programa académico ("…Programa de Ingeniería en
> Desarrollo de Software") y no por trabajo QA real. Revisa el objeto antes de
> postular. Se corregirá con la capa de scoring semántico (pendiente).

Las secciones 4–7 de `guia_busqueda_secop_independiente.md` (checklist de 7
puntos, documentos de persona natural, certificaciones, red flags) son de
**revisión humana** — requieren leer los pliegos (PDF) de cada proceso y no se
automatizan desde la API. Se conservan en ese archivo como guía de aplicación.

Detalle SoQL: Socrata `upper()` conserva acentos, así que los `LIKE` usan el
comodín `_` para la vocal tildada (`PRESTACI_N DE SERVICIOS`, `CONSULTOR_A`).

## Cómo correr

```bash
# Vista previa (no escribe nada):
pnpm discover:secop

# Crear/actualizar en Notion:
pnpm discover:secop --execute

# Parámetros opcionales:
pnpm discover:secop --since-days=30 --limit=200 --execute
```

Requiere `NOTION_TOKEN` en `.env` (ya configurado). El estado de sincronización
vive en `var/notion/oportunidades.json` (ids de base y de páginas + hashes).

## Relevancia y falsos positivos (leer)

La columna **Relevancia** es una heurística determinista de palabra clave, **no**
un puntaje semántico:

- **Alta**: hay término de software/QA (p. ej. "desarrollo de software",
  "pruebas de software") o un término IA/ML junto a contexto de servicio real
  (desarrollo, implementación, plataforma, algoritmo, chatbot…).
- **Media**: el término aparece de forma más tangencial.

El pipeline descarta ruido evidente (impresión/encuadernación/libro, dotación,
capacitación) pero **quedan falsos positivos** (p. ej. un cargo administrativo
cuyo objeto menciona "desarrollo de software" de pasada). Trata la lista como
**candidatos a revisar manualmente**, empezando por los "Alta". La precisión
mejorará cuando se construya la capa de scoring semántico (pendiente).

Última carga verificada (2026-07-19, filtro persona natural + guía SECOP
independiente + descarte de contratos ya adjudicados en modo publicitario):
**10 oportunidades aplicables** (todas Alta). En total se archivaron 100 de las
110 de la carga amplia inicial (gran escala/bienes, presupuesto empresarial,
adjudicadas/cerradas, proveedor ya contratado, y ruido de "solo mención de IA").
Si te parece muy estricto, se puede subir el tope de $150M o incluir "Media".

## Límites

- Es un **puente** que no usa Postgres (no disponible en el entorno actual):
  la idempotencia es por archivo, no hay historial `job_versions` ni dedupe
  cruzado con otras fuentes. Si se retoma Postgres, conviene migrar SECOP al
  pipeline principal (adapter → `jobs`/`opportunities` → sync) con un ADR para el
  esquema `opportunity`.
- Solo escribe campos del sistema; la base es nueva y no tiene campos humanos
  aún. Si agregas columnas humanas, no las sobreescribe (no las emite).
