# Línea base del auditor de AdSense — 2026-11-15

Cambio: `openspec/changes/adsense-readiness`, fase **F0**. Rama
`claude/adsense-f0-audit-5fec2b` sobre `codex/adsense-readiness` (`449c981`,
F1a + F1b). F2 (PR #138), F3 (PR #137) y F4 (PR #139) **no están
fusionados** aquí.

- Datos: build sintético (`envDir: false`) y PostgreSQL desechable
  (`production-baseline.sql` + `tests/fixtures/adsense-audit.sql`). Ninguna
  petición a producción.
- Informe: [`adsense-audit-baseline.json`](adsense-audit-baseline.json). Solo
  indicadores: estados, evidencia en una línea, rutas sintéticas y conteos.
  No incluye HTML, texto de páginas ni datos personales.
- Reproducir: `npm run adsense:audit` (requiere Docker y Chromium de
  Playwright). La suite compara los 50 estados con ese JSON y falla si alguno
  cambia. Para actualizar la línea base cuando se fusione una fase, copia el
  informe nuevo que imprime la suite.

## Resultado

| | CUMPLE | PARCIAL | NO CUMPLE | MANUAL |
|---|---:|---:|---:|---:|
| `proposal.md` (2026-11-14) | 26 ✅ | 15 ⚠️ | 9 ❌ | — |
| Auditor sobre esta rama | **21** | **1** | **14** | **14** |

Hay 36 reglas medibles por código y 15 de ellas no cumplen: AV-1, AV-2, AV-4,
CX-1, CX-2, CX-3, CX-4, CX-6, SP-1, SP-2, SP-6, SP-11, SP-12, PP-5 y TX-1.
Por eso `npm run adsense:audit -- --base-url …` sale con código 1. Es lo
esperado hasta F2–F5. La suite aislada pasa porque comprueba que el auditor
**reproduce esta matriz**. Ese es el gate de F0 ajustado por F1.

| Métrica (design.md) | Valor | Umbral del gate |
|---|---:|---|
| `original_pages` | 10 | ≥ 40 (F5); ≥ 20 en F3 |
| `original_words` | 2.291 | ≥ 30.000 |
| `copied_indexable_share` | 0,667 (2 de 3 vacantes indexables de la muestra sintética) | según D1 |
| `ads_on_ineligible_routes` | 0 | 0 |
| `raw_html_words` mínimo en páginas de texto | 109 (`/legal/uso-aceptable`) | ≥ 150 |
| `ssr_hydration_parity` (palabras) | 93,6 % | 100 % |
| `broken_internal_links` | 0 de 150 comprobados | 0 |
| `duplicate_policy_pages` | 0 | 0 |

`original_pages` y `original_words` se calculan desde `sitemap-pages.xml`.
Cuentan las páginas indexables de familias con texto propio: las
institucionales (`/about`, `/metodologia`, `/contact`, `/como-funciona`,
`/preguntas`, `/fuentes`), las cuatro legales y los hijos de `/guias/`,
`/informes/` y `/herramientas/`. No cuentan la portada, los listados, las
vacantes, `/privacy` (resume `/legal/privacidad`) ni `/docs` (referencia de la
API). Cuando se fusionen F3, F4 o F5, el auditor las contará sin cambios.

## Diferencias con `proposal.md`, regla por regla

Estado: C = CUMPLE · P = PARCIAL · N = NO CUMPLE · M = MANUAL.

### F1 movió estas reglas (ya hecho en `codex/adsense-readiness`)

| ID | Propuesta | Auditor | Evidencia |
|---|:-:|:-:|---|
| PP-1 | ❌ | C | `/login`, `/reset-password`, `/cuenta`, la URL inexistente y la vacante vencida: sin marcador `bt-ads` y sin petición a `adsbygoogle.js` en Chromium |
| PP-2 | ⚠️ | C | `/opiniones` y el hub de Santa Marta (5 vacantes) sin anuncios |
| PP-3 | ⚠️ | C | `/dashboard` con y sin filtros, sin anuncios |
| PP-4 | ❌ | C | Las dos vacantes de LinkedIn no llevan anuncios. Control positivo: la vacante de «Portal oficial» sí lleva el marcador |
| AV-5 | ⚠️ | C | `/metodologia`: 549 palabras en el HTML inicial, enlazada desde `/about` y desde el pie |
| CX-5 | ⚠️ | C | `/privacy` ya no contradice a `/legal/privacidad` sobre pagos. «Más empleos» no se repite entre vacantes hermanas (0 enlaces en común). La rotación por `stableHash` ya existía antes de F2 |
| SP-17 | ⚠️ | C | `/contact` explica en el HTML inicial cómo retirar una vacante |
| SP-19 | ⚠️ | C | «Reportar esta vacante» visible en la vacante oficial y en la de terceros, tras hidratar |
| PG-5 | ⚠️ | C | Una sola historia de privacidad: Google, publicidad, cookies y cómo desactivar la personalización. **Pendiente:** D5 (CMP) |
| CX-9 | ⚠️ | C | La vacante vencida responde 410 con noindex y sin anuncios; la URL inexistente, 404; 0 enlaces rotos de 150. **Pendiente:** soft 404 en Search Console |

### Dependen de F2, F3 o F4 (PR sin fusionar): NO CUMPLE declarado

| ID | Propuesta | Auditor | Qué falta |
|---|:-:|:-:|---|
| AV-1 | ❌ | N | `original_pages` 10 < 40, `original_words` 2.291 < 30.000, hubs sin análisis propio (F4) y D1 sin decidir |
| AV-2 | ⚠️ | N | `/guias` (F3) e `/informes` (F4) responden 404 |
| AV-4 | ⚠️ | N | 0 guías (F3) y 0 herramientas (F5, D6 sin decidir) |
| CX-1 | ❌ | N | `original_pages` 10 y `original_words` 2.291 |
| CX-2 | ❌ | N | Hubs sin `data-hub-comparison` (F4) y D1 sin decidir |
| CX-3 | ❌ | N | 0 guías publicadas y ningún informe mensual |
| CX-4, SP-11, SP-12 | ❌ | N | D1 sin decidir. Las vacantes de terceros ya nombran la fuente, enlazan al original y no llevan anuncios. Con D1(a) registrada pasarían; con D1(b) el auditor exige noindex, sin JobPosting y fuera del sitemap |
| CX-6, SP-2 | ⚠️ | N | El hub de Santa Marta (5 vacantes) es indexable y está en `sitemap-categories.xml`. F4 trae `staticHubRobots` |
| SP-6 | ⚠️ | N | La portada CO y la VE tienen una lista de solo enlaces cada una (≥ 8 enlaces y < 20 % de texto propio) |

### Hallazgos nuevos del auditor

| ID | Propuesta | Auditor | Hallazgo |
|---|:-:|:-:|---|
| TX-1 | ⚠️ (F1 lo dio por hecho) | N | **`/fuentes` llega incompleta sin JavaScript:** 130 palabras en el HTML inicial frente a 189 después de hidratar. Además, cuatro páginas completas quedan bajo el umbral de 150 palabras de `design.md`: `/legal/uso-aceptable` (109), `/como-funciona` (113), `/fuentes` (130) y `/legal/cookies` (139) |
| SP-1 | ✅ «falta prueba» | P | La prueba existe y la paridad es del 93,6 % de las palabras. Hay texto que solo está en el HTML del servidor. Entre las palabras que faltan después de hidratar están las de la miga de pan («inicio», «empleos») y los títulos de vacantes del bloque «Más empleos» y de la lista del hub de Bogotá: 77 %, la peor página. También difiere la redacción en `/como-funciona`, `/opiniones`, `/dashboard` y la portada. La lista de palabras de cada página está en `indicadores.navegador[].palabrasAusentes`. Ninguna página baja del 75 %, pero el umbral es el 100 %. Hay que revisarlo antes de F6 |
| PP-5 | ✅ | N | `/empresas` lleva el marcador (≥ 10 vacantes), pero su contenido es solo una lista de empresas: 83 palabras en el sintético, que tiene 16 empresas. En producción muestra 48 empresas y probablemente supere 150 palabras. Hay que medirlo con `--live` y decidir si un directorio de enlaces debe llevar anuncios (PP-3/PP-5) |

### Dependen del propietario o de Google: MANUAL

El código no puede comprobarlas. Cada entrada del JSON dice qué hay que
verificar. Con un archivo `--attest` (fecha y evidencia) pasan a CUMPLE.

| ID | Propuesta | Qué hay que verificar |
|---|:-:|---|
| AV-3 | ⚠️ | Sesiones y fuentes en GA4 y opiniones publicadas reales. El auditor anota que `/opiniones` sigue mostrando «Todavía no hay opiniones publicadas» |
| CX-10 | ✅ | Chromium, Firefox y WebKit, en escritorio y móvil (F6). Chromium de escritorio: 22/22 páginas sin errores de JavaScript |
| SP-3, SP-7, SP-8, SP-13, SP-18 | ✅ | Declaraciones del propietario: dominio, enlaces, tráfico automatizado, reputación y elusión |
| SP-4, MA-1 | ✅ | Search Console: problemas de seguridad y acciones manuales |
| SP-10 | ✅ | Revisión humana de que el buscador hace lo que dice |
| SP-16 | ✅ | Moderación de opiniones (`npm run test:site-feedback`) |
| PG-1, PG-2, PG-7 | ✅ | Conducta del propietario, GA4 → Adquisición y edad del titular |

### Sin cambios (✅ en la propuesta y CUMPLE en el auditor)

CX-7 (pie con contacto, acerca de, metodología y legales; 0 enlaces rotos),
CX-8, SP-5 (sin texto oculto, salvo acordeones y variantes responsivas),
SP-9, SP-14, SP-15, PP-6, PG-3, PG-4, PG-6 (`ads.txt` coincide con la meta
`google-adsense-account`) y TX-2.

## Lo que F0 no puede medir

- **Clics de Google a vacantes de terceros en 28 días** (insumo de D1): son
  datos de Search Console. Es una tarea MANUAL del propietario y no se
  inventa.
- **Vacantes indexables por procedencia en producción:** el modo `--live` las
  estima con una muestra del sitemap de vacantes (4 por defecto, dentro del
  límite de URLs). Requiere aprobación del propietario y **no se ha
  ejecutado**.

## Modo `--live`

`npm run adsense:audit -- --live [--max-urls 40] [--delay-ms 1000] [--browser]`

- Solo GET contra `https://buscotrabajo.co`.
- 40 URLs por defecto, con un tope duro de 120.
- Una pausa de 1 s o más entre peticiones.
- User-Agent genérico `Mozilla/5.0 (compatible; site-audit/1.0)`.
- El informe se guarda en el directorio temporal.
- `--browser` también carga en Chromium las páginas de la muestra, con sus
  recursos del mismo origen. Las peticiones a Google se abortan siempre.

Se probó el perfil contra el servidor local (descubrimiento por sitemap,
presupuesto, pausa y solo GET) en `tests/validate-adsense-audit.ts`: 8 GET en
unos 7 s. El User-Agent y el rechazo de métodos distintos de GET, de hosts
ajenos, de pausas menores de 1 s y de más de 120 URLs se prueban sin red en
`tests/validate-adsense-audit.test.ts`.
