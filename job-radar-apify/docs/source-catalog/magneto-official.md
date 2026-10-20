# Magneto como tablero oficial (páginas de empresa magneto365.com/co/empresas/{slug})

Investigación `source-researcher` del 2026-10-20 para `docs/adr/0006-direct-employers.md` §6/§7
(pregunta abierta "Magneto"). Decisión del dueño: la página de empresa de Magneto a la que enlaza
el sitio PROPIO de la empresa cuenta como su portal oficial. Leyenda: **[DOC]** documentado
oficialmente; **[OBS]** observado el 2026-10-20, no garantizado; **[NV]** no verificado.
UA de todas las peticiones: `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`, espaciadas >= 3 s,
~45 peticiones en total, ninguna con evasión. Fixtures: `fixtures-magneto/` (misma carpeta).

## 0. Veredicto

- **Viabilidad: PARCIAL.** Se puede leer, sin API ni login, la página de listado
  `https://www.magneto365.com/co/empresas/{slug}/empleos` (SSR, flight data de Next.js) y cada
  detalle (JSON-LD `JobPosting`). robots.txt lo permite (sin query string).
- **El listado completo NO es demostrable cuando la empresa tiene más de 20 filas.** El SSR sirve
  solo la página 1 (20 filas) y **ignora** `?paginator[page]=N` (probado 3 veces) [OBS]. Solo se
  puede declarar `complete` solo con la regla estricta de §2.3 (rows.length == totalRows == totalHits ==
  faceta company_show_slug; p. ej. Claro: 9/9/9). Vanti ya falla: totalRows=21, 20 filas. Éxito 66, Colombina 39, Alkosto 90, Sura 57.
- **Términos de uso de Magneto sobre extracción: [NV].** No se pudo obtener el texto de los
  "Términos y condiciones para uso del sitio web" (la página de políticas solo expone la Política
  de datos personales; los T&C aparecen solo como título). Recomendación: pedir autorización/feed
  por escrito a Magneto antes de activar el conector (ver §8).
- **El adaptador de bolsa actual no cumple robots.txt** (§1.3) y no es reutilizable para esto.

## 1. Cumplimiento

### 1.1 robots.txt literal (https://www.magneto365.com/robots.txt, HTTP 200, 1947 bytes) [OBS]

Copia íntegra en `fixtures-magneto/robots.magneto365.com.txt`. Reglas que aplican a
BuscoTrabajoBot (no tiene grupo propio, aplica `User-agent: *`):

```
User-agent: *
Allow: /
Allow: /*.css  (también .js .jpg .svg .png .ttf .woff .jpeg .gif)
Disallow: /*?
Allow: /*paginator[page]
Disallow: /manager/*
```

Grupos nombrados: se permiten explícitamente CCBot, ChatGPT-User, GPTBot, Google-Extended,
anthropic-ai, ClaudeBot, Applebot-Extended, PerplexityBot, Bytespider; se prohíben (Disallow: /)
BeBeeBot, 008, JobdiggerSpider, Cliqzbot, ia_archiver, OmniExplorer_Bot, buscaempleoefectivo,
jobrapido, kitempleo, Baiduspider, Scrapy, MegaIndex.ru. Sitemaps declarados:
sitemaps.magneto365.com/{sitemap-jobs,sitemap-jobsites,by-occupation,by-location,by-sector,search-hit,by-occupation-with-location}.xml,
www.magneto365.com/co/sitemap.xml, empresas.magneto365.com/sitemap.xml. Existe /llms.txt
("Evitar URLs con parámetros"; lista páginas de empresa como canónicas).

Evaluación RFC 9309 (gana la coincidencia más larga; empate -> Allow):

| URL que usaríamos | Resultado |
|---|---|
| /co/empresas/{slug} y /co/empresas/{slug}/empleos | PERMITIDO (Allow: /, sin ?) |
| /co/empresas/{slug}/empleos/{jobSlug} (detalle) | PERMITIDO |
| /co/empleos/{slug}-{id} (detalle global) | PERMITIDO |
| sitemaps.magneto365.com/sitemap-jobs.xml | declarado como Sitemap en el robots de www; 200 |
| cualquier URL con ? (p. ej. /co/empleos?q=...) | **PROHIBIDO** (Disallow: /*?) |
| ...?paginator[page]=N | PERMITIDO (Allow: /*paginator[page], 19 chars, gana a 3 chars) |
| static.magneto365.com/* (JS/CSS de Next) | robots de ese host: User-agent * / Disallow: / -> NO se leyeron los bundles |
| sitemaps.magneto365.com/robots.txt | 403 AccessDenied (XML) |

### 1.2 Términos de uso [NV]

- Política de datos personales (https://www.magneto365.com/co/politicas/politica-de-tratamiento-de-datos-personales-magneto-global-s-a-s):
  sin cláusula sobre scraping/bots/reutilización de ofertas [OBS, lectura del texto].
- "Términos y condiciones para uso del sitio web www.magnetoglobal.com" y "Términos y
  Condiciones Magneto TEC": solo se ven los títulos en la barra lateral; **texto no obtenido**.
  La ruta /home/politicas/terminos-condiciones-uso-plataforma-magneto/ redirige (301) a la
  política de datos. Una búsqueda web indica que los T&C cubren magneto365.com, la app y los
  asistentes, y que Magneto se define como agencia privada de gestión y colocación de empleo
  autorizada por el Servicio Público de Empleo [NV: resumen de buscador, no texto oficial].
  No se encontró API pública ni portal de desarrolladores [NV].
- Los datos de la oferta los publica la empresa empleadora; Magneto es intermediario. Aun así
  el T&C pendiente puede restringir la reutilización: no asumir permiso.

### 1.3 Cómo lo hace hoy nuestro adaptador de bolsa (no aplica) [DOC: código del repo]

src/index.ts scrapeMagneto(keyword) pide https://www.magneto365.com/co/empleos?q={kw} con
pickUserAgent() (UA de navegador, no el del bot), extrae "rows":[ del flight data y, como
respaldo, el JSON-LD ItemList; publishedAt lo fabrica como hoy y la fecha como "Reciente".
Problemas: (1) **/co/empleos?q= está prohibido por Disallow: /*?**; (2) UA de navegador en
lugar del UA del bot; (3) no usa la página de empresa, no pagina, no declara completitud;
(4) no tiene fecha real. fetchMagnetoDetail solo lee el JSON-LD del detalle (permitido).
Conclusión: reutilizar la idea de parseo del flight data, no el endpoint.

## 2. Cómo listar las vacantes de una empresa

Método más ligero disponible (no hay API pública): **HTML SSR de Next.js App Router**. No hay
__NEXT_DATA__: los datos viajan en self.__next_f.push([1,"..."]) [OBS].

### 2.1 Endpoint

GET https://www.magneto365.com/co/empresas/{slug}/empleos -> 200 text/html, ~630 KB. El listado ya
viene filtrado a Colombia (filtersApplied.filters.locations=["C47"] en todos): boardTotal es el
subconjunto Colombia y las ofertas no-CO de la misma empresa no aparecen (análogo a country=co de
SmartRecruiters). Primera
petición: Cache-Control s-maxage=600, stale-while-revalidate; con query: no-store. Sin cookies ni
login. Plantillas de ruta (en el flight data): jobsByCompany /empresas/{companySlug}/empleos,
jobsViewByCompany /empresas/{companySlug}/empleos/{jobSlug}, landing /empresas/{companySlug}.
La landing /co/empresas/{slug} NO trae vacantes (0 filas) [OBS]; solo enlaza a /empleos.

### 2.2 Extracción

1. Concatenar los argumentos string de todos los self.__next_f.push([1,"..."]) (decodificar el
   string JSON) -> flight stream (~630 KB, 103 pushes en Vanti).
2. Localizar "searchResponse":{"totalRows":R,"totalHits":H,"counters":[...],"algorithm":"wenesday-v1.0.0","rows":[...]}
   y parsear rows (array JSON; emparejar corchetes respetando strings).
3. description de cada fila es una **referencia "$4a"** a un chunk de texto del stream con
   framing ID:T<longitud_en_BYTES_hex>,<contenido HTML>; 3 de 109 filas lo traen inline.
   Resolver por longitud en bytes UTF-8. Alternativa: usar la descripción del JSON-LD del
   detalle (una petición por vacante).
4. JSON-LD ItemList en el HTML con las URLs de detalle (20 en página 1): contraste
   (itemListElement.length == rows.length; coincidió en 5/5 listados medidos).
5. filtersApplied.paginator = {page:1,pageSize:20}; filters.company_show_slug=[slug].

Fixtures reales recortados: listing-claro-colombia-complete.html (9/9),
listing-vanti-incomplete.html, listing-grupo-exito-incomplete.html (verificado que un parser
con el mismo método los lee).

### 2.3 Paginación y total: el punto débil

| Hecho | Evidencia [OBS] |
|---|---|
| Página de 20 filas (escritorio; móvil 10; opciones 20/30/60) | filtersApplied.paginator.pageSize=20; config pagination.desktop.pageSizeOptions=[20,30,60] |
| El HTML contiene enlaces ?paginator[page]=1 y =2 (robots los permite) | href=".../vanti/empleos?paginator[page]=2" |
| **El servidor ignora ese parámetro**: ?paginator[page]=2, ?paginator%5Bpage%5D=2 y la petición RSC (cabecera RSC: 1) devuelven la página 1 (mismas ids; paginator.page=1) | 3 pruebas, Vanti; Éxito también (1 prueba) |
| ?paginator[page]=1&paginator[pageSize]=30 no cambia el tamaño (sigue 20) | 1 prueba |
| No se halló API JSON pública; la paginación real parece ocurrir en el cliente por una llamada no visible en el HTML. Los bundles están en static.magneto365.com (robots Disallow: /) y no se leyeron | -- |
| totalRows != totalHits: Vanti 21/25; Éxito 66/2904; Colombina 39/292; Alkosto 90/345; Sura 57/212; Claro 9/9. Semántica **[NV]**: probable totalRows = filas distintas y totalHits = ofertas/cupos con ciudades repetidas | contadores del SSR |

**Prueba de listado completo (regla estricta, solo alcanzable en casos pequeños):** kind "complete"
únicamente si rows.length == totalRows == totalHits, ItemList.length == rows.length y el total de
la faceta company_show_slug (counters[field=company_show_slug] para el slug pedido) == totalHits y
filters.company_show_slug contiene el slug pedido. Medido: la faceta company_show_slug es IGUAL a
totalHits en las 6 empresas (Vanti 25, Claro 9, Colombina 292, Alkosto 345, Sura 212, Éxito 2904),
no a totalRows; por eso totalHits es el recuento de ofertas y totalRows (filas agrupadas) NO basta:
una empresa con totalRows=15, totalHits=40 y 15 filas ocultaría 25 ofertas. Si cualquiera de las
igualdades falla (Vanti: 21 != 25 y 20 != 21) -> kind "error" ("listado incompleto"), sin cierres
(coherente con BoardListing de src/direct/types.ts). Claro (9/9/9/9) es el único que pasa.
boardTotal para la guardia de caída masiva = totalHits.

Vías para superar el límite (no probadas; requieren decisión) **[NV]**:
- (a) pedir a Magneto un feed/API o autorización escrita (preferida);
- (b) navegador (Playwright) pulsando "Siguiente" como usuario: método más pesado y la política
  de Magneto es [NV]; requiere aprobación explícita del dueño;
- (c) sitemap-jobs.xml (31 477 URLs /co/empleos/{slug}-{id}, sin empresa; con retraso de ~1 día:
  la oferta 1106481 publicada hoy no estaba): asignar ofertas a empresa exige 1 petición por
  oferta -> inviable como listado por empresa; solo sirve de contraste.

## 3. Campos por vacante

Fuente A = fila del listado (rows[], 59 claves). Fuente B = JSON-LD JobPosting del detalle
(/co/empresas/{slug}/empleos/{jobSlug} o /co/empleos/{jobSlug}).

| Campo RawAtsPosting | Origen | Estado |
|---|---|---|
| externalId | rows[].id (entero, p. ej. 1102061; sufijo de jobSlug). publicId = UUID alterno | estable [OBS] |
| title | rows[].title | OK |
| applyUrl | https://www.magneto365.com/co/empresas/{companySlug}/empleos/{jobSlug}. La postulación ocurre en Magneto tras registro (canApply:true); no hay URL externa de aplicación | construida |
| locationTexts | rows[].cities[] (p. ej. "Bogotá, D.C."; hasta 10 ciudades) y departments[] (región) | OK |
| countryCodes | rows[].countryIds=[47] (47 = Colombia según countries:[{id:47,country:"Colombia"}] de la config) y JSON-LD addressCountry "CO" -> ["CO"] | OK (109/109 filas = 47) |
| structuredCity | cities[0] solo si hay una sola ciudad (96/109); con varias -> null | derivado |
| workplace | Solo isRemote:true -> remote (17/109). isRemote:false NO implica presencial: la faceta work_modality (onSite/hybrid) existe por empresa, NO por fila -> null | parcial |
| descriptionText | HTML en chunk $id (fila) o description del JSON-LD (detalle); convertir a texto | OK |
| department | sectors[0].name (sector, p. ej. "Bodega, logística y transporte") o JSON-LD occupationalCategory. Es sector, no departamento organizacional | aproximado |
| employmentType | contractOrder.name (Término fijo, Término indefinido, Contrato de aprendizaje, Por obra o labor); JSON-LD employmentType (FIXED_TERM...) | OK |
| publishedAt | rows[].publishDate (ISO absoluto con hora, p. ej. 2026-10-16T20:28:31.928Z) = JSON-LD datePosted (2026-10-16). Declarada por el sitio. **[NV]**: si republicar reinicia la fecha | declarada |
| validThrough | rows[].expirationDate (2026-11-16T05:00:00.000Z) = JSON-LD validThrough (2026-11-16) | OK |
| companyName | rows[].companyName; varía por sub-marca ("Claro"/"Claro Colombia"; "Grupo Éxito"/"Grupo-Éxito Corporativos" bajo el mismo slug) | OK |

Salario (fuera de RawAtsPosting; solo si declarado): salary, minSalary, maxSalary,
currencyCode "COP", toAgree (true = a convenir). 48/109 filas con toAgree:false; ahí
salary == minSalary (p. ej. 1 750 905) y maxSalary a veces 0 (sin tope declarado). Con
toAgree:true los montos pueden ser 0 o un mínimo (Vanti 1102061: minSalary 3 000 000 con
toAgree:true) -> **no inferir salario si toAgree:true** [NV semántica].
Otros: experienceMonthsNumber, educationLevel[], numberOfQuotas, isUrgent, keywords[],
status "published" + pageState "to_post" (109/109), confidential (109/109 false; si fuera true
el nombre de empresa podría ocultarse [NV]). Los campos de estado de usuario (isSaved,
isApplied...) son ruido. La URL del logo trae una firma con expiración: no almacenar.

Faltan respecto al schema canónico: nada bloqueante; workplace y structuredCity quedan null
con frecuencia; department es sector; el problema real es la completitud (§2.3).

## 4. Vacante cerrada o inexistente

- Id/slug inexistente (/co/empresas/vanti/empleos/analista-inexistente-999999999 y
  /co/empleos/analista-inexistente-999999999) y empresa inexistente (/co/empresas/zz-no-existe-xyz
  y su /empleos): **HTTP 500** con meta robots noindex y la plantilla "La oferta de empleo o
  página que intentas acceder ya no está disponible." [OBS]. **No es un 404 limpio**: un 500
  también podría ser una falla real, así que NO prueba cierre (igual que SmartRecruiters 400).
- Oferta expirada o retirada de verdad: **[NV]**; no se pudo reproducir un caso real (las ofertas
  más antiguas del sitemap seguían vigentes hasta su validThrough). Señales posibles:
  desaparición del listado; expirationDate/validThrough pasada; status distinto de "published"
  (solo se observó "published").
- Consecuencia: canConfirmClosure("magneto") = false; cerrar solo por ausencia en un listado
  complete (dos señales negativas, como en el resto de la tubería).

## 5. Empresas verificadas (2026-10-20)

El HTML del sitio propio se leyó con el UA del bot; el href se extrajo del elemento a (no se
siguen dominios ajenos salvo la página de Magneto indicada). Conteos del SSR de Magneto.
Detalle en fixtures-magneto/site-links-evidence.json.
Nota de proceso: las home de ~10 sitios propios se pidieron en el mismo paso que su robots.txt
(sin haberlo evaluado antes); solo se extrajeron hrefs y no se guardó HTML en el repo.

| Empresa | Página del sitio propio | href a Magneto (anchor) | Slug | totalRows / totalHits / filas p.1 | Completo |
|---|---|---|---|---|---|
| Vanti | https://www.grupovanti.com/ (home del grupo; la home de vanti.com.co no enlaza a Magneto) | https://www.magneto365.com/co/empresas/vanti ("Trabaja con Vanti") | vanti | 21 / 25 / 20 | NO |
| Claro Colombia | https://www.claro.com.co/institucional/empleos-claro/ (la home enlaza "Trabaja con nosotros" a esta página) | https://www.magneto365.com/co/empresas/claro-colombia ("Oportunidades laborales") | claro-colombia | 9 / 9 / 9 | SI |
| Colombina | https://colombina.com/co-es/contactanos/trabaja-con-nosotros (la home lo enlaza como "Trabaja con Nosotros") | https://www.magneto365.com/co/empresas/colombina ("CONOCE NUESTRAS VACANTES") | colombina | 39 / 292 / 20 | NO |
| Grupo Éxito | https://www.grupoexito.com.co/es (/ responde 301) | https://www.magneto365.com/grupo-exito ("Oportunidades de empleo"; 301 a /co/empresas/grupo-exito) y un href envuelto por Trend Micro cuyo destino es /co/empresas/grupo-exito | grupo-exito | 66 / 2904 / 20 | NO |
| Alkosto-Ktronix | https://www.alkosto.com/ (home) | https://www.magneto365.com/co/empresas/alkosto-ktronix ("Trabaja con nosotros") | alkosto-ktronix | 90 / 345 / 20 | NO |
| Sura Colombia | https://www.sura.co/seguros (destino de segurossura.com.co). robots.txt de sura.co respondió 403 con cabecera X-Malicious-User-Agent-Detected: true (bloqueo por UA de bot, sin pantalla CAPTCHA) -> política del repo: blocked; solo evidencia, no reintentar con otro UA | https://www.magneto365.com/co/empresas/seguros-sura ("Trabaja con nosotros") | seguros-sura | 57 / 212 / 20 | NO |

Robots de los sitios propios: grupovanti.com, claro.com.co, colombina.com, grupoexito.com.co y
alkosto.com sin prohibición para esas rutas (home y página de empleo).

**Contra-ejemplo:** www.homecenter.com.co enlaza a https://www.magneto365.com/hn/empresas/homecenter
(sitio de Honduras): el conector debe fijar la región /co/ y rechazar otros prefijos de país.
Sin enlace a Magneto en la home: postobon.com, crepesywaffles.com, tcc.com.co, davivienda.com,
colsubsidio.com (no se exploraron sus rutas de empleo). El llms.txt de Magneto lista además
Compensar, Comfama, Nutresa, Banco Agrario, Banrep, Davivienda: NV hasta ver el enlace en su
sitio propio. Un enlace desde el dominio de la empresa a /co/empresas/{slug} es la evidencia
(coherente con src/direct/discovery/ats-links.ts, que ya extrae "magneto" y el slug).

## 6. Forma propuesta del conector (para quien implemente)

- atsType "magneto"; atsRef = slug (REF_PATTERN existente); portalUrl =
  https://www.magneto365.com/co/empresas/{slug}. Solo región /co/.
- listBoard: un GET /co/empresas/{slug}/empleos sin query. Empresa inexistente (500) -> error,
  no not_found. Sin searchResponse -> error. complete solo con la condición de §2.3; si no,
  error con "listado incompleto: totalRows N > filas M".
- Completitud: regla estricta de §2.3 (rows == totalRows == totalHits == faceta del slug).
- Mapeo: §3. externalId y applyUrl siempre de la fila. publishedAt solo de publishDate; nunca
  fabricar. Resolver referencias $id de description por longitud en bytes.
- Pruebas de contrato con los 3 fixtures; canario real bajo --allow-live-sources.
- No habilitar en producción mientras §1.2 siga [NV].

## 7. Texto descargado = dato no confiable

Las descripciones traen HTML pegado desde Word (estilos inline, nbsp) y texto libre de las
empresas; se trató como dato. No se encontraron instrucciones dirigidas a agentes en lo leído.
Los fixtures recortan descripciones a 240 caracteres de texto y eliminan logos firmados, videos
y estado de usuario; sin correos ni teléfonos (verificado con regex).

## 8. Riesgos y decisiones abiertas para el dueño

1. Términos de uso de Magneto [NV]: pedir autorización o feed por escrito.
2. Completitud: sin paginación accesible por GET solo las empresas con <= 20 filas pueden
   cerrarse. Hoy: Claro sí; Vanti, Éxito, Colombina, Alkosto y Sura no.
3. El adaptador de bolsa actual consulta una URL con ? prohibida por robots y usa UA de
   navegador: corregir o documentar la excepción (fuera de este informe).
4. publishDate podría reiniciarse al republicar [NV]: validar antes de ordenar por fecha.
5. Sura: robots.txt del sitio propio devolvió 403 (X-Malicious-User-Agent-Detected: true); queda blocked, solo evidencia; el enlace se vio en la home alcanzable por redirect.
6. **Discovery actual no reconoce el href de Éxito**: src/direct/discovery/ats-links.ts solo acepta ^/co/empresas/{slug}; https://www.magneto365.com/grupo-exito da slug null y el href envuelto por Trend Micro está en otro host. Para contarlo como verificado hace falta ampliar la regex a /{slug} o resolver UN redirect del mismo host (301 a /co/empresas/grupo-exito), validando que el destino final sea /co/empresas/{slug}. /hn/ (Homecenter) ya queda rechazado por la regex actual: correcto.
