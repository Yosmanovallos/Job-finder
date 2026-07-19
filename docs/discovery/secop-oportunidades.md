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
3. Mapea cada proceso a una `Opportunity` (sin inventar campos ausentes:
   presupuesto/ciudad/URL quedan `null` si la fuente no los declara).
4. Crea/actualiza páginas en la base Notion **"Oportunidades (SECOP)"** (bajo la
   página "radar de empleo"), con idempotencia por archivo — re-correr no
   duplica.

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

Última carga verificada (2026-07-19): 110 oportunidades (62 Alta, 48 Media).

## Límites

- Es un **puente** que no usa Postgres (no disponible en el entorno actual):
  la idempotencia es por archivo, no hay historial `job_versions` ni dedupe
  cruzado con otras fuentes. Si se retoma Postgres, conviene migrar SECOP al
  pipeline principal (adapter → `jobs`/`opportunities` → sync) con un ADR para el
  esquema `opportunity`.
- Solo escribe campos del sistema; la base es nueva y no tiene campos humanos
  aún. Si agregas columnas humanas, no las sobreescribe (no las emite).
