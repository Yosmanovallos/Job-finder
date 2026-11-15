# Guías (`/guias`)

Fuente de las guías editoriales de BuscoTrabajo (OpenSpec
`adsense-readiness`, fase F3, requisito ADS-040). Cada guía es un archivo
`<slug>.md` en esta carpeta. El servidor solo publica las guías válidas **y**
aprobadas por el propietario, y solo mientras `GUIDES_ENABLED` está en
`true` en `src/config.ts`. `npm run test:unit` valida todos los archivos de
esta carpeta: una guía inválida rompe la prueba.

## Metadatos

```
---
slug: periodo-de-prueba
titulo: Periodo de prueba en Colombia: duración, reglas y qué pasa si te despiden
descripcion: (entre 50 y 170 caracteres)
autor: (nombre de la persona u organización que firma)
autor_tipo: Person | Organization
publicada: AAAA-MM-DD   (fecha real de salida a producción; vacía en borrador)
actualizada: AAAA-MM-DD (última revisión del contenido)
etiquetas: contratos, sin-experiencia
revision_propietario: pendiente | aprobada
revisado_por: (nombre de quien revisó y aprobó)
fecha_revision: AAAA-MM-DD
---
```

- `revision_propietario: aprobada` solo la escribe el propietario (o se
  escribe por instrucción explícita suya, guía por guía). Nunca se
  rellena por adelantado.
- `publicada` es la fecha real en que la guía sale a producción. No se
  inventan fechas pasadas ni se escalonan para simular una cadencia.

Etiquetas que usan los hubs y las vacantes para enlazar guías
(`GUIDE_TAGS` en `src/lib/guides.ts`): `buscar-empleo`, `hoja-de-vida`,
`entrevista`, `ofertas-falsas`, `contratos`, `prestaciones`,
`sin-experiencia`, `remoto`, `servicio-publico-de-empleo`.

## Cuerpo

Markdown restringido: `##` y `###`, párrafos, listas `-` o `1.`,
`**negrita**`, enlaces `[texto](https://…)` o `[texto](/ruta)`. No se
admite HTML, imágenes, tablas ni `#` (el título sale de `titulo`).

## Fuentes

Las fuentes van al final, una por línea, y se citan en el texto con
`[^id]`:

```
El periodo de prueba no puede exceder dos meses.[^cst78]

[^cst78]: [Código Sustantivo del Trabajo, art. 78](https://www.secretariasenado.gov.co/...) — consultado el 2026-11-14
[^bt]: [BuscoTrabajo, API pública](https://buscotrabajo.co/api/v1/jobs?country=CO&search=...&limit=1) — corte 2026-11-14
```

## Reglas que comprueba el validador

1. Todo párrafo o viñeta con una cifra (dígito, `%`, `$`) o una norma
   (artículo, ley, decreto, resolución, Código Sustantivo, sentencia,
   circular) cita una fuente oficial: dominio `*.gov.co` o `sena.edu.co`,
   por `https`. Un dato del corpus de BuscoTrabajo vale como fuente de su
   propia cifra si lleva `corte AAAA-MM-DD`.
2. Cada guía tiene al menos un dato propio del corpus con fecha de corte,
   reproducible con la URL citada (la API pública devuelve
   `pagination.total`).
3. Al menos 800 palabras útiles (párrafos y viñetas; no cuentan títulos ni
   fuentes).
4. Ningún párrafo de más de 40 palabras se repite entre guías.
5. Existen los campos de revisión del propietario; sin `aprobada`, la guía
   no se publica, no entra al sitemap y no se enlaza.
6. Toda fuente definida se cita y toda cita tiene fuente.

## Ritmo

12 guías para la primera solicitud de AdSense y luego 2 por semana. No se
publican en bloque.
