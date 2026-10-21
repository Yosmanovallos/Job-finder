# IBM (ibm.com/careers) - investigacion 2026-10-20

Leyenda: [DOC] [OBS] [NV]. UA BuscoTrabajoBot/1.0.

## Veredicto

NO sin permiso de IBM, aunque tecnicamente el API devuelve datos. Razones: (1) la unica via de listado es un endpoint NO documentado (www-api.ibm.com/search/api/v2), cuyo cuerpo de peticion no salio de ninguna fuente oficial; (2) las Reglas de conducta de https://www.ibm.com/legal/terms prohiben "any robot, spider, site search/retrieval application, or other manual or automatic device or process to retrieve, index," y "data mine"; solo permiten crawlers segun robots.txt; (3) careers.ibm.com (detalle y sitemap) responde con desafio AWS WAF (202, x-amzn-waf-action: challenge): no se puede verificar el link ni cerrar por 404, y NO se evade. Vacantes en Colombia hoy [OBS]: 16, todas con dcdate entre 2026-10-09 y 2026-10-19 (<= 30 dias).

## Hechos

- Plataforma: ibm.com/careers/search es una app que consulta el API; detalle y postulacion viven en careers.ibm.com (Avature, ibmglobal.avature.net en robots).
- robots.txt de www.ibm.com: Allow /careers; no prohibe /search/api (la regla es /search/?). www-api.ibm.com/robots.txt hace 301 a www.ibm.com. careers.ibm.com/robots.txt: Allow /careers, sitemap careers.ibm.com/careers/sitemap_index.xml; los hijos (es_ES, en_US) responden 202 con challenge.
- Endpoint [OBS]: POST https://www-api.ibm.com/search/api/v2, JSON, sin auth, CORS *. Cuerpo usado: appId careers, scopes [careers2], query bool.must term field_keyword_05 = Colombia, size, from, sort dcdate desc, _source con lista explicita (el comodin y listas largas dan 400). Respuesta estilo Elasticsearch: hits.total.value 16 (relation eq). from=40 -> hits vacio. Completitud: acumular hits == total.
- Campos [OBS]: url (careers.ibm.com/careers/JobDetail?jobId=133480), title, description, dcdate (fecha absoluta; NO se sabe si es publicacion o actualizacion), field_keyword_05 pais, field_keyword_19 "Bogota, CO", field_keyword_21 ciudad, field_keyword_17 workplace (Hybrid; ausente en practicas), field_text_01 id, field_keyword_08 area.
- Faltan: validThrough y estado de cierre verificable (WAF).

## Divulgacion

Unos 8 POST al API (pruebas de campos, 2 con 400) y 2 GET (sitemap y detalle) con challenge. No se harian mas.

## Fixtures

fixtures-ibm/search-api-response.json, search-api-offset-past-end.json, detail-waf-challenge.txt
