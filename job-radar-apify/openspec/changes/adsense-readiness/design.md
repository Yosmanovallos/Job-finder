# Diseño — adsense-readiness

Cada fase es una sesión y un PR desde un worktree `codex/` creado en
`origin/main`. Todas tienen interruptor de retroceso y no tocan el caché ni
el precalentado del dashboard (`docs/DASHBOARD-PERFORMANCE-RUNBOOK.md`).

## F0 — Auditor `adsense:audit`

Script determinista, sin LLM, de solo lectura. Dos modos:

- `npm run adsense:audit` — contra un build local con datos sintéticos
  (misma base que `test:baseline`); corre en CI.
- `npm run adsense:audit -- --live` — contra producción, solo GET, con
  límite de páginas y pausa entre peticiones. Requiere aprobación explícita.

Salida: JSON con una entrada por regla de la matriz
(`id`, `estado`, `evidencia`, `umbral`, `valor`). Sale con código ≠ 0 si
alguna regla no cumple. El informe se guarda en el directorio temporal del
sistema, no en el repo.

Mediciones que introduce:

| Métrica | Definición | Umbral del gate |
|---|---|---|
| `original_pages` | Páginas indexables cuyo texto principal es nuestro (guías, informes, herramientas, institucionales) | ≥ 40 |
| `original_words` | Palabras de esas páginas, sin menú ni pie | ≥ 30.000 |
| `copied_indexable_share` | Vacantes indexables de portales de terceros ÷ total de URLs indexables | ver D1 |
| `ads_on_ineligible_routes` | Rutas no elegibles que cargan el script de anuncios | 0 |
| `raw_html_words(ruta)` | Palabras en el HTML inicial de cada página de texto | ≥ 150 |
| `ssr_hydration_parity` | Texto del HTML inicial contenido en el DOM hidratado | 100 % |
| `broken_internal_links` | Enlaces internos con 404 en la muestra rastreada | 0 |
| `duplicate_policy_pages` | Páginas legales con el mismo propósito | 0 |

Los umbrales de `original_pages` y `original_words` son criterio propio, no
una cifra de Google (Google no publica ninguna). Se eligen para que la capa
original sea lo primero que encuentre quien navegue desde la portada.

## F1 — Confianza, higiene y elegibilidad de anuncios

### Elegibilidad de anuncios (PP-1..PP-5)

Hoy `index.html` inyecta `adsbygoogle.js` en todas las rutas. Pasa a
decidirlo una función pura `isAdEligibleRoute(pathname, pageState)`:

| Ruta | Anuncios |
|---|---|
| `/guias/*`, `/informes/*`, `/herramientas/*` | sí |
| `/empresas`, `/empresas/:slug`, hubs `/empleos/:slug` con ≥ 10 vacantes | sí |
| Vacante de portal oficial, vigente y `seo_ready` | sí |
| Vacante de portal de terceros | **no** |
| `/dashboard`, `/empleos` como buscador con filtros | no |
| `/login`, `/reset-password`, `/auth/callback`, `/cuenta` | no |
| 404, vacante vencida, estados vacíos o de error | no |
| `/docs`, `/opiniones`, `/legal/*`, `/contact` | no |

La carga diferida (primera interacción o 4 s) se conserva. El servidor
escribe la decisión en el HTML inicial (`<meta name="bt-ads" content="on">`,
`src/lib/ad-eligibility.ts`) y el cargador de `index.html` solo inyecta
AdSense si la encuentra; por defecto, ninguna página lleva anuncios.
Retroceso: revertir el commit (no hay interruptor de entorno).

**Implementado (F1a):** la tabla se aplica así hoy — portada; `/empleos` y
hubs indexables con ≥ 10 vacantes; `/empresas` y empresas con ≥ 10;
vacante de «Portal oficial» lista para Google. `/guias`, `/informes` y
`/herramientas` se marcarán cuando existan.

**Limitación:** Auto ads cargado en una página elegible sigue activo si la
visita navega dentro de la app a una no elegible. Complemento en el panel:
exclusiones de página de Auto ads para `/dashboard`, `/login`, `/cuenta`.

**Despliegue:** si Cloudflare tiene HTML en caché, purgarlo antes de pedir
la revisión, para que no queden copias con el cargador anterior.

### Páginas de texto en el HTML inicial (TX-1)

`/legal/*`, `/como-funciona`, `/preguntas`, `/fuentes`, `/about`,
`/contact` renderizan en el servidor el mismo texto que muestra la página
hidratada. Las preguntas del acordeón van completas en el HTML (el acordeón
está permitido por la política de texto oculto).

### Una sola versión de cada página (CX-5, PG-5)

- `/privacy` se queda en 200: está en el contrato de agentes (tests,
  sitemap, `llms.txt`). Se corrige su texto para que no contradiga a
  `/legal/privacidad` sobre pagos (hoy no se procesan). El texto legal
  completo sigue siendo el de `src/lib/legal-content.ts`, que pinta
  `Legal.tsx` y el servidor.
- `/about` y `/contact` conservan la URL (están en `llms.txt` y en el
  catálogo de agentes) y se enlazan desde el pie.

### Confianza (AV-5, SP-17, SP-19)

- **Acerca de:** quién es el responsable (D2), desde cuándo existe, cómo se
  obtienen, deduplican y verifican las vacantes, cada cuánto, y qué no hace
  el sitio. Solo hechos comprobables en el código o dados por el
  propietario.
- **Metodología** (`/metodologia`): las reglas reales de deduplicación,
  verificación de vigencia (dos señales negativas para cerrar) y retención.
  Es contenido original y es la respuesta directa a «selección y
  mantenimiento estructural continuos».
- **Retiro de contenido y denuncia de ofertas falsas:** procedimiento
  público, enlace «Reportar esta vacante» en cada página de vacante, plazo
  de respuesta.
- **Opiniones:** la sección «Opiniones publicadas» no se renderiza mientras
  no haya ninguna.

## F2 — La superficie copiada

### Clasificación

Cada vacante pública tiene una procedencia, ya disponible en los datos:

- **Oficial:** viene del portal de empleo del propio empleador (ATS). El
  empleador la publica para que se difunda.
- **Terceros:** viene de otro portal de empleo.

### Tratamiento

| | Oficial | Terceros — D1(a) | Terceros — D1(b) |
|---|---|---|---|
| Descripción | completa | completa | extracto ≤ 300 caracteres |
| Bloques propios (empresa, ciudad, reputación, vigencia verificada) | sí | sí | sí |
| JobPosting | sí | sí | **no** (el contrato exige descripción completa) |
| Indexable | según `seo_ready` | según `seo_ready` | no; fuera del sitemap |
| Anuncios | sí | no | no |

D1(b) queda implementada detrás de `THIRD_PARTY_JOB_EXCERPT_ENABLED`
(apagada). Encenderla exige un ADR que enmiende
`docs/JOBPOSTING-GOOGLE-CONTRACT.md` y la medición previa de F0: cuántos
clics de Google llegan hoy a vacantes de terceros.

En ambos casos:

- Las vacantes vencidas responden 404 o 410 real, sin anuncios y sin
  enlaces entrantes desde hubs (CX-9).
- El bloque «Más empleos en <ciudad>» deja de ser idéntico entre vacantes
  hermanas: se ordena por cercanía de cargo con la vacante actual (CX-5).
- Más inventario oficial es la palanca de fondo: se coordina con
  `ats-inventory-co-2026-11` y `official-coverage-co-2026-10`, sin duplicar
  su alcance.

## F3 — Capa editorial `/guias`

- Rutas: `/guias` (índice) y `/guias/:slug`. Contenido en Markdown
  versionado en el repo, renderizado en el servidor, con `Article` en
  JSON-LD, autor, fecha de publicación y de revisión, y lista de fuentes.
- Temas: lo que busca quien está buscando empleo en Colombia y que el sitio
  puede tratar con autoridad — hoja de vida, entrevista, tipos de contrato,
  prestaciones, periodo de prueba, liquidación, cómo reconocer una oferta
  falsa, Agencia Pública de Empleo del SENA, empleo sin experiencia, trabajo
  remoto desde Colombia. La lista inicial sale del estudio de palabras clave
  (#121).
- **Reglas de calidad** (son las que separan esto de SP-11):
  - cada cifra o norma lleva enlace a su fuente oficial (Mintrabajo, DANE,
    Código Sustantivo del Trabajo, SENA); sin fuente, no se escribe;
  - cada guía aporta algo que solo tenemos nosotros: datos del corpus
    (cuántas vacantes piden X, en qué ciudades) con fecha de corte;
  - revisión y firma humana antes de publicar (D3);
  - ≥ 800 palabras útiles, sin relleno; ningún párrafo repetido entre guías;
  - ritmo: 12 para la primera solicitud, luego 2 por semana. No se publican
    en bloque.
- Navegación: «Guías» entra al menú principal y al pie; cada hub y cada
  vacante enlaza a 2–3 guías relacionadas.
- Si se usa un LLM para borradores, aplica la regla 11 de `AGENTS.md`
  (prompt versionado, esquema, presupuesto, pruebas). El texto publicado es
  el revisado por una persona.

## F4 — Datos propios

- **Informe mensual** `/informes/empleo-colombia-AAAA-MM`: vacantes activas
  por ciudad, cargo, modalidad y fuente; empresas que más publican;
  variación contra el mes anterior. Calculado por código desde el corpus,
  con nota metodológica y límites declarados (por ejemplo, el tipo de
  contrato y el salario tienen cobertura baja y se dice).
- **Hubs:** cada hub suma un párrafo calculado propio (cómo se compara esta
  ciudad o cargo con el total nacional, qué empresas concentran la oferta)
  y enlaces a la guía y al informe. Los hubs que no alcanzan 10 vacantes
  siguen sin indexarse (SP-2).
- **Portada:** las listas de ciudades y cargos pasan a ser secciones con
  cifra y contexto, no hileras de enlaces (SP-6).

**Implementado (2026-11-15), con dos cambios respecto a lo de arriba:**

- **Ediciones congeladas en el repositorio, no cálculo en vivo.** `jobs`
  solo guarda 30 días, así que la variación mensual y una URL estable por
  mes exigen congelar cada edición. `scripts/build-market-report.ts` hace
  una sola consulta acotada (`queryMarketRows`: la proyección canónica del
  dashboard, columnas ligeras, sin URL, id ni descripción) dentro de
  `BEGIN READ ONLY` con `statement_timeout`, agrega en código y escribe
  `data/market-reports/<CO|VE>-<AAAA-MM>.json` (`--dry-run` por defecto).
  El archivo trae solo agregados: un grupo con menos de 10 vacantes se
  suprime; la fecha de corte y la metodología van dentro. El servidor lee
  los archivos una vez (`src/server/market-reports.ts`); ninguna petición
  consulta la base para el informe, los hubs ni la portada. Decisión del
  plan (sesión principal, 2026-11-15); la tabla nueva o leer
  `archived_jobs` quedaron descartadas sin aprobación del propietario.
- **URL:** cada edición vive en `/informes/empleo-colombia-AAAA-MM`;
  `/informes/empleo-colombia` responde 302 a la más reciente y `/informes`
  las lista (200 `noindex` y fuera del sitemap mientras no haya ninguna).
  Sin marcador de anuncios. `REPORTS_ENABLED=false`: 404 real y fuera del
  sitemap.
- **Hubs:** párrafo calculado contra la edición más reciente del país del
  hub. Los hubs simples de ciudad o cargo con menos de 10 vacantes pasan a
  `noindex,follow` (antes solo con 0) y salen de `sitemap-categories.xml`
  cuando la edición más reciente (de menos de 45 días) los cuenta por
  debajo de 10.

## F5 — Herramientas

Calculadoras deterministas, del lado del cliente, sin guardar datos:
liquidación de contrato y salario neto mensual. Cada fórmula cita su
artículo o decreto, los valores anuales (salario mínimo, auxilio de
transporte, UVT) viven en un archivo con fuente y fecha, y hay pruebas
unitarias con casos resueltos a mano. Un aviso deja claro que es una
estimación, no asesoría legal.

## F6 — Gate y solicitud

1. `adsense:audit --live` con las 50 reglas en CUMPLE.
2. Search Console: sin acciones manuales ni problemas de seguridad; guías e
   informes indexados.
3. Al menos 14 días con la capa nueva en producción y publicándose a ritmo
   normal (AV-2: presencia constante). Es criterio propio de prudencia.
4. Prueba en Chromium, Firefox y WebKit, escritorio y móvil.
5. El propietario marca «Confirmo que he resuelto los problemas» y solicita
   la revisión. Es una acción suya en su cuenta.

## Compatibilidad

- Dashboard: sin cambios en consultas, caché ni arranque. Comprobación en
  frío y con URL única según el runbook en cada fase que toque el servidor.
- Agentes: `llms.txt`, API Catalog, docs y digests se actualizan solo con
  rutas reales; se conserva la negociación HTML/Markdown, los 404 reales y
  `Vary`.
- Render: sin servicios nuevos ni cambio de plan.

## Retroceso

Cada fase tiene su interruptor (`ADS_ROUTE_ALLOWLIST_ENABLED`,
`THIRD_PARTY_JOB_EXCERPT_ENABLED`, `GUIDES_ENABLED`, `REPORTS_ENABLED`,
`TOOLS_ENABLED`). Apagar uno deja las rutas nuevas en 404 real y el resto
del sitio como en `320fcec`.
