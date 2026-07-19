# Workana — catálogo de fuente

> Fuente: **Workana** (workana.com), plataforma de proyectos freelance, foco LatAm.
> No existe API pública ni feed RSS/Atom documentado u observado. El acceso automatizado a
> contenido de proyectos está bloqueado por los Términos de Servicio, independientemente de lo
> que `robots.txt` permita técnicamente. Ver veredicto en §8.
> Fuentes primarias consultadas: <https://www.workana.com/robots.txt>,
> <https://www.workana.com/sitemap_index.xml>, <https://www.workana.com/pages/view/terms>,
> `help.workana.com` (vía snippets de búsqueda — fetch directo devolvió 403).
> Última verificación empírica: 2026-07-19.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | Ninguna vía ligera disponible (jerarquía §2.3 del plan) — todas las vías de mayor valor están ausentes o bloqueadas por ToS |
| API pública/oficial | **No existe** (verificado — sin portal de developers, sin documentación) |
| RSS/Atom | **No encontrado** (probado empíricamente, no solo buscado — ver §2.2) |
| Sitemap | Existe (`sitemap_index.xml` → 300 sub-sitemaps), pero su uso para extraer contenido de proyectos **viola el ToS** |
| HTML detalle de proyecto | Server-side renderizado, con campos ricos — pero acceso automatizado **bloqueado por ToS** |
| HTML listado de proyectos | **No** renderizado server-side; carga vía JS/endpoint interno `/api/` (bloqueado en `robots.txt`) |
| Alertas por email | Existen (perfil → skills), contenido del email **no verificado** (help center 403 al fetch directo) |
| Vía recomendada | Alerta por email + revisión/copia humana, o import manual puro — **no automatizable de extremo a extremo con garantías hoy** |

## 2. Métodos de acceso evaluados (orden de la jerarquía del plan)

### 2.1 API pública

Búsqueda directa de documentación oficial: sin resultados. No hay dominio tipo
`developers.workana.com` ni sección de API en `help.workana.com`. La página
`https://www.workana.com/en/freelancers/api` es una landing de "contratar developers de API"
(freelancers), no documentación de una API propia.

`robots.txt` bloquea `Disallow: /api/`, lo que confirma que existe un endpoint interno usado por
el frontend, pero: no está documentado públicamente, está explícitamente bloqueado a crawlers, y
usarlo sería "endpoint privado por reverse-engineering" — prohibido por las reglas del proyecto y
por el ToS (§4). **No se investiga ni se propone su uso.**

Existen proyectos de terceros no oficiales en GitHub que hacen scraping no autorizado —
mencionados solo para constancia, **no se recomienda ni se documenta su método**.

### 2.2 RSS / Atom — probado empíricamente, no solo buscado

- Página de categoría IT: sin `<link rel="alternate" type="application/rss+xml">` en el HTML.
- `?format=rss` → responde HTML normal (parámetro ignorado).
- `https://www.workana.com/rss/jobs` → **HTTP 404**.
- Conclusión: **no encontrado**.

### 2.3 Sitemap público

- `robots.txt` declara `Sitemap: https://www.workana.com/sitemap_index.xml`.
- `sitemap_index.xml` apunta a 5 sub-índices; uno (`.808.xml`) es a su vez un `sitemapindex` con
  **300 sub-sitemaps** comprimidos, potencialmente millones de URLs. No se descomprimió ninguno.
- Ver §4: usar este sitemap para extraer contenido de proyectos de forma automatizada está
  bloqueado por el ToS aunque `robots.txt` no prohíba esos paths.

### 2.4 HTML + JSON-LD

- 3 páginas de detalle verificadas: **sin** bloques `<script type="application/ld+json">`. No hay
  datos estructurados `JobPosting`/`Offer`.

### 2.5 HTML + selectores

Las páginas de detalle **sí están renderizadas server-side** (campos en §6) — técnicamente la vía
"HTML + selectores", pero descartada por el ToS (§4), no por razones técnicas.

Las páginas de **listado** **no** traen proyectos en el HTML plano — se cargan vía JS / el mismo
`/api/` bloqueado. Sin vía ligera de descubrimiento de proyectos nuevos.

### 2.6 Alertas por email / búsquedas guardadas

Documentado en `help.workana.com` (vía snippets — fetch directo devolvió **403**, "documentado
por la fuente, no verificado directamente"):

- Existe "Notificaciones y alertas" en la cuenta del usuario.
- El freelancer recibe un email cada vez que se publica un proyecto que requiere las **skills de
  su perfil** (no confirmado como búsqueda guardada libre por keyword + país).
- **No verificado**: si el email trae datos completos del proyecto o solo título + enlace.
  Determinante: si es solo un enlace, "enriquecerlo" automáticamente vuelve a caer en el bloqueo
  de ToS (§4) y colapsa a importación manual.
- Clasificación: **exportación autorizada por el usuario logueado** (regla 10), no newsletter
  público. El usuario configura su propia alerta; el sistema solo procesa correos que el propio
  usuario recibió.

## 3. `robots.txt` (verificado, 2026-07-19)

```
User-agent: *
Disallow: /api/
Disallow: /*?*ag=1
Disallow: /users/landing_choose*
Disallow: */login*?*
Disallow: */signup*?*
Sitemap: https://www.workana.com/sitemap_index.xml
```

`robots.txt` **no** bloquea `/job/` ni `/jobs/`. Esto **no** significa que scrapear esos paths sea
aceptable — el ToS (§4) prohíbe expresamente el scraping/crawling con cualquier propósito y
prevalece sobre lo que `robots.txt` permita técnicamente (AGENTS.md regla 8).

## 4. Términos de Servicio (verificado)

Fuente: <https://www.workana.com/pages/view/terms> (fetch directo exitoso, 2026-07-19).
Cláusula de "Uso Responsable y Conducta":

> "El acceso (o intento de acceso) a cualquiera de nuestros Recursos por otros medios que no
> sean los que nosotros proveemos está terminantemente prohibido. Específicamente aceptas no
> acceder (o intentar acceder) a cualquiera de nuestros Recursos a través de cualquier medio
> automático, inmoral o no convencional."

Un artículo espejo en `help.workana.com` (no accedido directamente, 403, citado vía snippet —
tratar como no confiable) describiría lenguaje más explícito prohibiendo "robots, spiders,
procesos manuales y/o automáticos" para "data-mine, data-crawl, scrape o indexar el sitio".

**Consecuencia**: cualquier acceso automatizado a listados o detalles (incluyendo iterar el
sitemap, o pedir HTML de `/job/...` en loop) **queda BLOQUEADO** por el ToS aunque `robots.txt`
no lo impida técnicamente. Alternativa permitida: alertas por email del propio usuario (§2.6,
condicional) o importación manual (regla 10).

## 5. Sistema de alertas — vía candidata (condicional, no confirmada al 100%)

Pendiente de verificar antes de construir cualquier adaptador:

1. Contenido exacto del email de alerta (¿presupuesto/skills/país o solo título+link?). Requiere
   que un usuario real configure una alerta y comparta un email de muestra.
2. Si permite scoping por keyword + país simultáneo, o solo por skills del perfil.
3. Frecuencia de envío (inmediata vs. digest).

Hasta confirmar (1), no se puede diseñar el parser del email ni decidir si la vía es
"semi-automatizable" o "manual".

## 6. Campos observados en página de detalle de proyecto (3 muestras, 2026-07-19)

**Observado, no garantizado** — sin documentación oficial; inferido de HTML server-side, sujeto a
cambios sin aviso.

| Campo observado | Presente en muestras | Notas |
|---|---|---|
| Título | Sí, 3/3 | |
| Descripción | Sí, 3/3 | Prosa libre, tratar como no confiable (regla 6 — posible inyección) |
| Categoría / subcategoría | Sí, 3/3 | ej. "Programación y Tecnología" / "Otros" |
| Skills requeridas | Sí, 3/3 | Lista de tags |
| Fecha de publicación | Sí, 3/3 | Formato localizado |
| Tipo de proyecto (único/por hora) | Parcial | |
| Plazo / duración | Parcial (1/3 con valor) | |
| Número de propuestas | Sí, 3/3 | |
| Estado (abierto/finalizado) | Sí, 3/3 | |
| **Presupuesto / moneda** | **No, 0/3** | No apareció en ninguna muestra. **Por-verificar** con muestra mayor (proyectos de precio fijo). |
| **País del cliente** | **No, 0/3** | No apareció. Filtro `?country=CO` existe en la UI, pero no confirmado en el detalle. **Por-verificar.** |
| Cliente (agregados: miembro desde, proyectos) | Sí, 2/3 | No PII directa |

## 7. Mapeo al esquema `opportunity` (Prompt…, líneas 298-336)

| Campo `opportunity` | Origen Workana | Notas |
|---|---|---|
| `source_name` | — | `"workana"` |
| `source_category` | — | `"freelance_marketplace"` |
| `external_id` | slug de la URL (`/job/<slug>`) | Sin ID numérico consistente |
| `title` | Título | |
| `organization` | Alias del cliente si aparece | A menudo solo agregados |
| `description` | Descripción | No confiable (regla 6) |
| `opportunity_type` | — | `"freelance_project"` |
| `service_category` | Categoría/subcategoría | |
| `skills` | Skills listadas | |
| `country` / `city` | **No observado** (§6) | → `null` hasta verificar |
| `remote_status` | Implícito, no explícito por proyecto | → `unknown` |
| `compensation_*` / `currency` / `budget_text` | **No observado** (§6) | → `null`/`unknown` |
| `published_at` | Fecha de publicación | Normalizar a ISO 8601 |
| `contact_name` / `contact_method` | **No expuesto** (mensajería interna, requiere login) | → `null` |
| `compliance_method` | — | `"manual_import"` o `"user_email_alert"` — **nunca** `"scraping"` |
| `raw_source_reference` | — | Referencia al email/URL que el humano importó |

## 8. Riesgos, limitaciones y veredicto

1. **Bloqueo de ToS, no técnico**: el silencio de `robots.txt` sobre `/job/` no es autorización;
   el ToS prohíbe el acceso automatizado y prevalece.
2. **Sin RSS ni API**: confirmado empíricamente.
3. **Listados no renderizados server-side**: sin vía ligera de descubrimiento sin tocar el `/api/`
   bloqueado.
4. **Alertas por email — vía condicional sin confirmar**: viabilidad depende de si el email trae
   datos completos o solo un link (no verificado). Hasta confirmarlo, tratar como importación
   manual, con posible asistencia de parseo si el contenido es autosuficiente.
5. **Campos clave ausentes en las muestras**: presupuesto/moneda y país no aparecieron en 0/3.
   `null`/`unknown` explícito hasta verificar con muestra mayor y consentimiento del usuario.
6. **Veredicto final**: Workana **no es una fuente automatizable de extremo a extremo** hoy. La
   única ruta compatible es **email de alerta configurado por el propio usuario + revisión/
   transcripción humana**, o **importación manual pura** (regla 10). **No** construir un
   `SourceAdapter` automatizado; si se desea incorporar sus proyectos, vía el flujo de importación
   manual existente, nunca vía scraping del sitio ni del sitemap.

---

## Notas del investigador

**Accedido directamente (fetch exitoso)**: `robots.txt`, `sitemap_index.xml` y sub-índice
`.808.xml`, `pages/view/terms`, 3 páginas de detalle reales, 3 de listado, 2 sondas de RSS.

**Documentado por la fuente pero NO verificado (403, solo snippets)**: artículo de notificaciones
por email y artículo de términos espejo en `help.workana.com`.

**No encontrado (búsqueda + prueba empírica)**: API pública oficial, feed RSS/Atom, JSON-LD en
detalle, programa de partner/data-provider oficial.

**Por verificar**: contenido de los 300 sub-sitemaps (bloqueado por ToS de todas formas);
presupuesto/moneda y país en proyectos recientes; contenido exacto del email de alerta.
