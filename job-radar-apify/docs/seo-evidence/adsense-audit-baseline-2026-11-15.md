# Línea base del auditor de AdSense

Cambio: `openspec/changes/adsense-readiness`, fase **F0**. La línea base se
generó el **2026-11-15** sobre `codex/adsense-readiness` (F1a + F1b) y se
**actualizó el 2026-11-18** sobre `origin/main`. Ese `main` ya incluye F1
(#136), F3 con las guías (#137, `GUIDES_ENABLED=true`), F2 (#138), F1c
(#144) y F4 (#139). F4 está desplegada, pero no hay ninguna edición en
`data/market-reports/`. F5 (#145, `/herramientas`) todavía no está fusionada.

- **Datos.** Build sintético (`envDir: false`) y PostgreSQL desechable
  (`production-baseline.sql` + `tests/fixtures/adsense-audit.sql`). Ninguna
  petición a producción. Las guías son las del repo, publicadas hasta la
  fecha del día (`colombiaToday()`).
- **Informe.** [`adsense-audit-baseline.json`](adsense-audit-baseline.json)
  contiene solo indicadores: estados, una línea de evidencia, rutas
  sintéticas y conteos. No incluye HTML, texto de páginas ni datos personales.
- **Reproducir.** Requiere Docker y el Chromium de Playwright.
  - `npm run adsense:audit` ejecuta el auditor. **Hoy sale con código 1 a
    propósito**, porque hay reglas medibles que no cumplen.
  - `npm run test:adsense-audit` es el gate de F0. Compara los 50 estados con
    ese JSON y falla si alguno cambia o si falta el archivo.
- **Límites de la línea base.**
  - La genera el propio auditor, así que sirve para detectar regresiones, no
    como prueba independiente. La justificación independiente es la tabla
    regla por regla de abajo.
  - **Depende de la fecha.** Las guías programadas salen 2 cada miércoles
    hasta el 2026-12-16. Con 10 guías (unas 20 páginas originales), CX-1
    pasará de NO CUMPLE a PARCIAL. Cuando eso pase, o se fusione F5 o exista
    un informe, copia el informe nuevo que imprime la suite y explica aquí
    cada estado que cambie.

## Resultado

| | CUMPLE | PARCIAL | NO CUMPLE | MANUAL |
|---|---:|---:|---:|---:|
| `proposal.md` (2026-11-14) | 26 ✅ | 15 ⚠️ | 9 ❌ | — |
| Auditor, 2026-11-15 (F1 sola) | 21 | 1 | 14 | 14 |
| **Auditor, 2026-11-18 (`main`)** | **24** | **4** | **8** | **14** |

Hay 36 reglas medibles por código y 12 todavía no cumplen. Por eso
`npm run adsense:audit` sale con código 1.

| Métrica (design.md) | Valor | Umbral del gate |
|---|---:|---|
| `original_pages` | 14 (10 institucionales y legales + 4 guías) | ≥ 40 (F5); ≥ 20 en F3 |
| `original_words` | 8.304 (2.380 + 5.924 de las guías) | ≥ 30.000 |
| `copied_indexable_share` | 0,667 (2 de 3 vacantes indexables de la muestra sintética) | según D1 |
| `ads_on_ineligible_routes` | 0 | 0 |
| `raw_html_words` mínimo en páginas de texto | 109 (`/legal/uso-aceptable`) | ≥ 150 |
| `ssr_hydration_parity` (palabras) | 99,6 % | 100 % |
| `broken_internal_links` | 0 de 150 comprobados | 0 |
| `duplicate_policy_pages` | 0 | 0 |

La capa original se descubre desde el índice `/sitemap.xml`: todos sus hijos
salvo vacantes y categorías, es decir, `sitemap-pages.xml` y
`sitemap-guides.xml`. Por eso solo se cuentan las guías **publicadas**, y los
informes y herramientas se contarán cuando aparezcan en un sitemap. Las
familias que cuentan:

- las institucionales: `/about`, `/metodologia`, `/contact`, `/como-funciona`,
  `/preguntas` y `/fuentes`;
- las cuatro páginas legales;
- las páginas hijas de `/guias/`, `/informes/` y `/herramientas/`.

No cuentan la portada, los listados, las vacantes, `/privacy` (resume
`/legal/privacidad`) ni `/docs` (referencia de la API).

## Qué cambió del 2026-11-15 al 2026-11-18 y por qué

| ID | Antes | Ahora | Motivo |
|---|:-:|:-:|---|
| CX-4, SP-11, SP-12 | N | **C** | **Cambio del auditor.** Antes exigía que el propietario registrara D1. Ahora mide la opción que aplican las páginas: hoy es D1(a), porque el extracto está apagado y la página completa es indexable. Comprueba que se cumple: fuente nombrada, enlace al original y sin anuncios. Queda **pendiente** que el propietario confirme D1 con `--attest`, como en las demás reglas mixtas |
| AV-2 | N | P | `/guias` responde 200 y es indexable (F3). `/informes` responde 200 pero con noindex, porque no hay ninguna edición |
| AV-4 | N | P | 4 guías publicadas de las 12 del umbral; 0 herramientas (F5 sin fusionar, `/herramientas` responde 404) |
| CX-3 | N | P | 4 guías publicadas; todavía no hay informe mensual |
| AV-1, CX-1 | N | N | `original_pages` subió de 10 a 14 y `original_words` de 2.291 a 8.304, pero sigue lejos de 40 páginas y 30.000 palabras |
| CX-6, SP-2 | N | N | Las causas cambiaron, ver «Brechas reales» |

El resto no cambió. Que el texto de evidencia ya no diga «sin fusionar» es
deliberado: el auditor dice lo que mide (estado HTTP, noindex, conteos) en
lugar de suponer qué PR falta.

## NO CUMPLE y PARCIAL: brechas reales o errores del auditor

| ID | Estado | ¿Real? | Diagnóstico |
|---|:-:|---|---|
| **TX-1** | N | **Real.** Ya estaba antes de este merge | `/fuentes` llega incompleta sin JavaScript: tiene 130 palabras en el HTML inicial y 226 hidratada. Lo que solo aparece después de hidratar es un párrafo real («diez pestañas abiertas, cada una con su propio buscador…») y los nombres de las fuentes. F1 dio `/fuentes` por resuelta («ya lo tenía»), pero su render del servidor no incluye esa sección. Además, 4 páginas completas quedan bajo las 150 palabras de `design.md`: `/legal/uso-aceptable` (109), `/como-funciona` (113), `/fuentes` (130) y `/legal/cookies` (139). Las demás páginas de texto están completas, con al menos el 90 % de las palabras de la versión hidratada |
| **CX-6, SP-2** | N | **Real.** Depende de los datos de F4 | El hub de Santa Marta (5 vacantes) ya lleva `noindex,follow` (F4, `staticHubRobots`), pero **sigue en `sitemap-categories.xml`**. El sitemap solo excluye un hub cuando hay un snapshot de mercado que conozca su total (`knownStaticHubTotal`). Sin ninguna edición en `data/market-reports/`, el hub se queda listado: es una señal contradictoria (noindex dentro del sitemap). Además, ningún hub tiene `data-hub-comparison`, por la misma causa |
| **AV-1, CX-1, CX-2** | N | **Real** | La capa original es pequeña (14 páginas, 8.304 palabras) y no hay análisis propio en los hubs mientras no exista un informe |
| **SP-6** | N | **Real** | La portada CO y la VE tienen una lista de solo enlaces cada una (≥ 8 enlaces y < 20 % de texto propio). F4 añadió `buildHomeCityContext`, pero ese contexto depende del snapshot, que todavía no existe |
| **PP-5** | N | **Parcialmente un efecto del dato sintético** | `/empresas` lleva anuncios con 83 palabras, porque la muestra sintética tiene 16 empresas. En producción lista 48 y probablemente pase de 150 palabras. La pregunta de fondo sigue abierta: es un directorio de enlaces, ¿debe llevar anuncios? Hay que medirlo con `--live` |
| **SP-1** | P | **Real, menor** | Paridad del 99,6 % de las palabras. Las diferencias son de redacción entre el HTML del servidor y React: `/opiniones` 94 % («puedes escribir desde esta…»), y en las vacantes la etiqueta «Ubicación» y la fecha absoluta («noviembre») frente a la fecha relativa |
| **AV-2, AV-4, CX-3** | P | **Real, se resuelve con el tiempo** | Faltan guías hasta llegar a 12, el primer informe (que ejecute el propietario) y F5 |
| ADS-020 (fuera de la matriz) | — | **Real** | `/opiniones` muestra «Todavía no hay opiniones publicadas» en el HTML inicial |

**Errores del auditor corregidos en esta actualización:**

1. Solo leía `sitemap-pages.xml`, así que no veía `sitemap-guides.xml` y
   contaba 0 guías.
2. Daba CX-4, SP-11 y SP-12 por NO CUMPLE sin medir las páginas, solo porque
   D1 no estaba registrada.
3. La evidencia tenía textos fijos que decían «sin fusionar».

El TX-1 que se ve con el merge no es un error del auditor: es el mismo
hallazgo de `/fuentes` del 2026-11-15.

## MANUAL: dependen del propietario o de Google

El código no puede comprobarlas. Cada entrada del JSON dice qué hay que
verificar. Con un archivo `--attest` (fecha y evidencia) pasan a CUMPLE.

| ID | Qué hay que verificar |
|---|---|
| AV-3 | Sesiones y fuentes en GA4 y opiniones publicadas reales |
| CX-10 | Chromium, Firefox y WebKit, en escritorio y móvil (F6). Chromium de escritorio: 22/22 páginas sin errores de JavaScript |
| SP-3, SP-7, SP-8, SP-13, SP-18 | Declaraciones del propietario: dominio, enlaces, tráfico automatizado, reputación y elusión |
| SP-4, MA-1 | Search Console: problemas de seguridad y acciones manuales |
| SP-10 | Revisión humana de que el buscador hace lo que dice |
| SP-16 | Moderación de opiniones (`npm run test:site-feedback`) |
| PG-1, PG-2, PG-7 | Conducta del propietario, GA4 → Adquisición y edad del titular |

Pendientes dentro de reglas que ya cumplen por código:

- D1: el propietario confirma la opción (a) (CX-4, SP-11, SP-12).
- D5: activar el mensaje de consentimiento (CMP) (PG-5).
- Soft 404 en Search Console (CX-9).

Los clics de Google a vacantes de terceros, que son el insumo de D1, solo
están en Search Console y no se inventan.

## Modo `--live` (no ejecutado: requiere aprobación)

`npm run adsense:audit -- --live [--max-urls 40] [--delay-ms 1000]`

- Solo GET contra `https://buscotrabajo.co`.
- 40 URLs por defecto, con un tope duro de 120.
- Una pausa de 1 s o más entre peticiones.
- User-Agent genérico `Mozilla/5.0 (compatible; site-audit/1.0)`.
- El informe se guarda en el directorio temporal.
- Las vacantes de la muestra salen del sitemap de vacantes.

`--browser` no se admite con `--live`, porque las peticiones de la SPA no
tendrían pausa ni contarían en el límite. En el navegador solo salen GET y
HEAD al origen auditado.

El perfil se probó contra el servidor local en
`tests/validate-adsense-audit.ts` (8 GET en unos 7 s). El User-Agent y los
rechazos (métodos distintos de GET, hosts ajenos, pausas menores de 1 s y más
de 120 URLs) se prueban sin red en `tests/validate-adsense-audit.test.ts`.
