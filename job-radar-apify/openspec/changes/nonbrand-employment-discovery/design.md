# Diseño — entrega 1: baseline y selección

Base del worktree: origin/main `c724483735ba32fc7baa777acba8fa4cc09b3c27`,
verificada con fetch el 27-Oct. Rama: codex/nonbrand-seo-baseline.
La revisión de código no equivale a identificar el commit desplegado: las
observaciones públicas de baseline.md se identifican por fecha y URL.

## Contrato de evidencia

Search Console Web: 28 días 27-Sep..24-Oct y 90 días 27-Jul..24-Oct.
No mezclar períodos, países ni dimensión propiedad con dimensión página.
Conservar cifras redondeadas como tales. La consulta genérica busco trabajo
permanece separada de la marca explícita y de variantes ambiguas.
Los datos ocultos no se asignan a una categoría por resta.

Cruzar consultas seleccionadas mediante filtro exacto y pestaña Páginas.
Observar cinco inspecciones almacenadas; máximo una prueba viva en este lote,
sin Solicitar indexación ni reenvíos de sitemap. Anotar crawl/canonical cuando
estén disponibles. Una prueba viva positiva no demuestra inclusión en índice.

Inventario: GET anónimo de sitemap y categorías públicas; extraer únicamente
metadata y agregados del snapshot SSR. No leer env, credenciales ni usuarios.
No ejecutar suites históricas de SEO contra producción. Los totales visibles
no miden Google-ready. Los primeros 60 resultados no representan toda la BD;
las compañías son etiquetas distintas, no una auditoría de empleadores.
El listado público omite descripciones: su cobertura no puede inferirse aquí.

## Alcance y compatibilidad

Solo documentos OpenSpec. No código, SQL, migraciones, indexación solicitada,
analytics sintético, cambios de Google ni despliegue. No altera otros cambios
recientes del inicio, navegación o inventario ATS.
Rollback documental: revertir el commit de esta entrega; producción intacta.

## Decisión de salida

Máximo tres categorías CO y dos VE; este piloto usa dos CO y una VE.
Elegir URL existente + inventario visible + evidencia de intención, distinguiendo
captación de recuperación. No crear una categoría Puerto Ordaz por el solo hecho
de que una vacante de esa ciudad recibió clics. No publicar facetas de experiencia
o jornada sin contratos de datos comprobados. El siguiente cambio de aplicación
requiere su propia sesión y pruebas de SSR, enlaces, CO/VE y performance aplicables.
