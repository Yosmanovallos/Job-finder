# TP Colombia — portal oficial propio

Verificación de solo lectura: 2026-10-25. La [página de carreras de TP Colombia](https://www.tp.com/es-co/ubicaciones/colombia/carreras/) y la [búsqueda corporativa](https://www.tp.com/en-us/careers/job-opportunities/) publican vacantes en `tp.com`; la segunda carga su listado mediante `GET /Umbraco/Api/Careers/GetCareersBase` en el mismo dominio. El censo de Computrabajo Colombia de ese día tenía 33 vacantes bajo el nombre `TP`. No se asume que cada una tenga equivalente en el portal de TP.

## Acceso y completitud

- `https://www.tp.com/robots.txt` respondió HTTP 200 y no declara `Disallow`. El conector lo comprueba antes de consultar el listado, con el UA identificable `BuscoTrabajoBot/1.0`.
- La página corporativa llama al endpoint con `node=1780`, `country=Colombia`, `culture=en-US` y paginación desde `page=0`. El campo `totalRegistros` declara el total filtrado. Canario: páginas de 50, 50 y 32 = **132** filas, cuatro requests incluyendo robots; total estable y 132 ids propios únicos.
- La fuente mezcla páginas `Umbraco` en `tp.com` y páginas `iCIMS` enlazadas desde el mismo listado. Dos registros Umbraco históricos reutilizan `externalId`; la identidad estable del conector usa `nodeId` para Umbraco y host + `externalId` para iCIMS.
- Las filas declaran `date`, `country`, `location`, `title`, `description`, `url` y `workFromHome`. `date` no trae zona horaria; se conserva solo el día declarado, representado a medianoche UTC, sin atribuirle una hora exacta ni tomar `lastmod` del sitemap como fecha de publicación. Una fecha inválida o un cambio en total, forma, id o URL aborta el listado sin cierres.
- El canario leyó las 132 filas, de las cuales **10** cumplen la regla vigente de 30 días y **122** son más antiguas. Los 10 enlaces vigentes respondieron HTTP 200. Nueve apuntan a `tp.com` y uno a `careersspa-teleperformance.icims.com`; su `robots.txt` permite `/jobs/{id}/.../job`. La importación retiene solo las 10 recientes y sigue el cierre por dos listados completos del flujo oficial.

El API es interno a la página pública de TP, no una API documentada para terceros; si cambia o responde con bloqueo, el conector falla cerrado y no se inventan vacantes ni fechas. No se consulta Computrabajo para esta fuente.
