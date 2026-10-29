# Ofertas rastreadas sin indexar — contraste individual

Fecha: 2026-10-29. Propiedad sc-domain:buscotrabajo.co. Código de producción:
origin/main a964fce. Fase: auditoría acotada del siguiente grupo priorizado en
SEO-ALERTS-TRIAGE-2026-10-29.md. No cambia aplicación ni diseño.

## Hallazgo principal

Las **cinco primeras ofertas comprobadas individualmente ya están indexadas**,
aunque todavía figuran en los ejemplos del informe «Rastreada: actualmente
sin indexar». La inspección dice «La URL está en Google», «La página está
indexada» y detecta un JobPosting válido en cada una.

La página del grupo aún muestra 9.745 afectadas y actualización 22-Oct,
con ejemplos rastreados el 23/24-Oct. Las inspecciones individuales ampliadas
ya muestran rastreos del 26-Oct. Estas vistas no están sincronizadas.
No presentar 9.745 como un censo actualizado de ofertas activas excluidas,
ni restar cinco al contador para inventar un total nuevo.

Esto confirma indexación en la muestra; NO confirma buen posicionamiento
para «busco trabajo», «empleo» o cualquier consulta concreta. Tampoco demuestra
que todas las ofertas del grupo se hayan recuperado o que una acción anterior
de BuscoTrabajo haya causado esa indexación.

## Muestra y resultados

Selección: diez primeros ejemplos visibles del grupo; siete con fecha de
rastreo 24-Oct y tres de 23-Oct. Muestra dirigida a ejemplos recientes,
no aleatoria ni representativa de las 9.745. Diez GET a páginas propias;
cinco inspecciones individuales almacenadas de Google, sin pruebas en vivo
ni solicitudes de indexación en esta fase. Wizard sigue sin plan operativo;
no se usa inspección API/bulk ni se afirma un saldo de cuota disponible.

| Oferta / id corto | HTTP / canonical propio | Palabras de descripción* | Inspección individual Google |
|---|---|---:|---|
| Despachador, Yumbo / b5f3eeb4 | 200 / sí | 247 | Indexada; rastreo 26-Oct 09:47:32; canonical propio aceptado |
| Asistente contable, Caracas / 416a800f | 200 / sí | 164 | Indexada; rastreo 26-Oct 06:36:37; canonical propio aceptado |
| Analyst Clin Sales Surg, Medellín / 68047f01 | 200 / sí | 316 | Indexada; JobPosting válido; no se amplió su fecha/canonical de Google |
| Business development, Bogotá / 1000af57 | 200 / sí | 80 | Indexada; rastreo 26-Oct 03:09:42; canonical propio aceptado |
| Consultor comercial, Bogotá / a3193f22 | 200 / sí | 283 | Indexada; rastreo 26-Oct 03:32:31; canonical propio aceptado |
| Auxiliar de cumplidos / a56146ff | 200 / sí | 116 | No inspeccionada individualmente |
| Customer success, Caracas / e22a8ca3 | 200 / sí | 445 | No inspeccionada individualmente |
| Promotor, Fundación / 13e8158b | 200 / sí | 188 | No inspeccionada individualmente |
| Presupuesto de obra, Medellín / 1490d604 | 200 / sí | 558 | No inspeccionada individualmente |
| Servicio al cliente, Barranquilla / 57892132 | 200 / sí | 149 | No inspeccionada individualmente |

*Conteo de palabras del description de JobPosting, quitando etiquetas HTML
y normalizando espacios. Es descriptivo, no una puntuación de calidad ni
una regla de indexación de Google. El caso de 80 palabras tiene empleador
«Empresa confidencial» y ya está indexado: esta muestra NO justifica atribuir
su exclusión a longitud o anonimato ni inventar datos para enriquecerlo.

En las diez páginas:

- Un H1, canonical propio, un JobPosting y payload SSR detectados.
- No meta robots ni X-Robots-Tag noindex detectado en la respuesta.
- Diez hashes de descripción distintos: no hay igualdad textual entre estas
  diez; eso NO descarta duplicación semántica ni con otros portales/URLs.
- datePosted y validThrough presentes; el segundo aún futuro al observar.
  No se modifican ni se certifica su procedencia con una visita al empleador.
- Las diez URLs aparecen en sitemap-jobs.xml actual, 200 y XML parseable con
  7.950 URLs en el momento de lectura. No se han probado las 7.950 por HTTP.
- La oferta a3193f22 no tiene jobLocation físico porque declara TELECOMMUTE y
  applicantLocationRequirements Colombia. No clasificar esa ausencia como
  un error de dirección presencial.

HTTP 200 con oferta vigente en BuscoTrabajo no verifica por sí solo que el
empleador siga aceptando solicitudes. No se hicieron canarios de fuentes,
registros, postulaciones ni consultas a datos de usuarios.

Evidencia reproducible de metadatos y resultados:
`seo-evidence/crawled-audit-2026-10-29.json`. Solo datos públicos permitidos,
sin cuerpos HTML, descripciones completas, cookies o credenciales. Lectura
acotada a 3 MB por página, concurrencia dos, timeout 20 s; sitemap hasta
8 MB y 25 s. Repeticiones de lectura Google por sincronización de UI no se
cuentan como ofertas diferentes.

## Decisión y acción concreta

No hay fallo de render/canonical/noindex reproducido en esta muestra que
justifique un parche de producción. No se solicita indexación para páginas
que Google ya confirma indexadas ni se reinicia masivamente una validación
histórica fallida del 17-Sep.

Cambiar el criterio del seguimiento: ante un grupo agregado atrasado, verificar
una muestra individual antes de abrir una reparación o reportar exclusiones
actuales. Registrar URL, fecha, indexación, canonical y elegibilidad por separado.
La recuperación global del grupo permanece sin medir.

Para el objetivo de búsquedas genéricas, medir impresiones, posición y clics
de las páginas permanentes de ciudad/cargo; indexación por sí sola no basta.
La estrategia publicada ya prioriza esas páginas y la medición de retiros por
causa. La retención >30 días requiere su propia fase y ADR con disponibilidad
verificada; este resultado no autoriza conservar cerradas como activas.

Siguiente entrega independiente: medir el impacto de los retiros y diseñar
la decisión de ciclo de vida con datos agregados; mantener la revisión de
consultas/landings y la validación Soft 404 ya iniciada. No prometer primera
página ni crecimiento +500%/+1500% a partir de cinco inspecciones.

## Validación de esta entrega

Auditoría documental y JSON. Contraste local del JSON: diez URLs únicas,
todas 200/canonical propio/SSR/JobPosting/en sitemap; cinco inspecciones
individuales con indexed=true, sin contar las otras cinco como inspeccionadas.
Pruebas de código/render previas siguen referenciadas en la verificación P0;
no se presentan como reejecutadas por esta entrega. Lint, tipos, unitarias
del monorepo y diff documental se registran en el OpenSpec al cerrar.
