# Validación — employment-type-trust

## 1. Atribución por fuente

Punto de partida: `seo-intent-wave2/validation.md` §1 (2026-11-07). Entre
las aptas de CO: Tiempo completo 4.436, **Medio tiempo 2.094**, sin valor
1.167, Por día 346, Temporal 282, Prácticas 125, Contrato 104.

Desglose por `source`: consulta de solo lectura autorizada por el
propietario, corrida desde la sesión de seo-intent-wave2 el 2026-11-07
(`BEGIN READ ONLY`, `ROLLBACK`, 424 ms). Mismo filtro de aptas canónicas,
con `country IS NULL OR country = 'CO'`. Esta sesión no tiene acceso a
`.env`. `scripts/count-employment-type-by-source.ts` repite la consulta para
el recuento posterior al despliegue.

| `employment_type` | Total | Por fuente |
|---|---:|---|
| Medio tiempo | 2.096 | **Magneto 2.049**, LinkedIn 44, WeRemoto 2, Computrabajo 1 |
| Por día | 346 | **Elempleo 346** |
| Temporal | 282 | **Elempleo 237**, Magneto 37, LinkedIn 7, Computrabajo 1 |

Computrabajo queda descartado (1 fila), así que la ruta de detalle por
`translate.goog`, que el clasificador de esta sesión no dejó comprobar,
tampoco es la causa.

## 2. Fichas reales de la fuente (2026-11-07, solo lectura)

Método: búsquedas públicas de cada sitio y luego la ficha. Se extrae el
`employmentType` del bloque `application/ld+json` `JobPosting` y se compara
con lo que muestra la página. Pausa de 2 s entre peticiones. Magneto con
`BuscoTrabajoBot/1.0` (su robots.txt permite `/co/empleos/…`).

### Computrabajo (`co.computrabajo.com`): correcto, 10 de 10

| Ficha (título público) | JSON-LD | Visible |
|---|---|---|
| Auxiliar de seguridad – Medellín | FULL_TIME | Tiempo Completo · Obra o labor |
| Guarda de Seguridad Motorizado – Conjunto Residencial | FULL_TIME | Tiempo Completo · Obra o labor |
| Guardas de seguridad para almacén de cadena – Bucaramanga | FULL_TIME | Tiempo Completo · término fijo |
| Guía Canino de Seguridad Villa Rica | FULL_TIME | Tiempo Completo · Obra o labor |
| Auxiliares y operarios de producción | FULL_TIME | Tiempo Completo · Obra o labor |
| Operarias de Producción / Barrios Unidos | FULL_TIME | Tiempo Completo · Obra o labor |
| Operario de Limpieza planta de producción Funza | FULL_TIME | Tiempo Completo · Obra o labor |
| Conductor aeropuerto | FULL_TIME | Tiempo Completo · Obra o labor |
| Conductor auxiliar logístico – C2 | FULL_TIME | Tiempo Completo · Obra o labor |
| Conductor C1 / Repartidor / TAT / Sur | FULL_TIME | Tiempo Completo · Obra o labor |

Computrabajo separa jornada («Tiempo Completo») y contrato («Obra o labor»),
y su JSON-LD sigue la jornada.

### Magneto (`www.magneto365.com/co/empleos/…`): el valor es el contrato

| Ficha (slug público) | JSON-LD | Contrato visible | Horario visible |
|---|---|---|---|
| auxiliar-de-almacen-bogota-1129251 | **PART_TIME** | Por obra o labor | 9:00 a. m. a 8:00 p. m., rotativo |
| auxiliar-de-almacen-montacarguista-1129258 | **PART_TIME** | Por obra o labor | — |
| conductor-c3-planta-de-produccion-1129259 | **PART_TIME** | Por obra o labor | lunes a domingo, turnos rotativos |
| montacarguista-1129245 | **PART_TIME** | Por obra o labor | — |
| operador-de-proceso-1129256 | **PART_TIME** | Por obra o labor | — |
| operario-puente-grua-produccion-1129261 | **PART_TIME** | Por obra o labor | — |
| cajero-punto-de-venta-1129252 | FULL_TIME | Término indefinido | turnos de 7 h + 1 h de almuerzo |
| vendedor-6-horas-hc-suba-1129214 | **FULL_TIME** | Término indefinido | 6 horas (título) |
| prevencionista-armenia-temporal-1128879 | TEMPORARY | Temporal | — |

Correspondencia exacta en 9 de 9: obra o labor → `PART_TIME`, indefinido →
`FULL_TIME`, temporal → `TEMPORARY`. Falla en los dos sentidos: jornadas
completas como `PART_TIME` y un puesto de 6 horas como `FULL_TIME`. Explica
también la contradicción del conteo de wave2 («Operador De Tiendas Ara Medio
Tiempo» marcado «Tiempo completo»): esa vacante sería de término indefinido.

La fixture del corpus directo `tests/fixtures/direct/magneto/detail-jobposting-jsonld-vanti.json`
trae `FIXED_TERM`, otro valor de contrato que no es de schema.org: confirma
que el campo de Magneto describe el contrato.

### Elempleo (`www.elempleo.com/co/ofertas-trabajo/…`): el valor es el contrato

Campos visibles propios de la ficha: «Tipo de contrato» y «Jornada laboral».

| Ficha (título público) | JSON-LD | Tipo de contrato | Jornada laboral |
|---|---|---|---|
| Operario(a) de ensamble con experiencia | FULL_TIME | Indefinido | — |
| Auxiliar contable / soporte área impuestos | FULL_TIME | Indefinido | — |
| Operario/a de sellado | **PER_DIEM** | Por obra o labor | — |
| Operario/as de producción – Funza | **PER_DIEM** | Por obra o labor | Tiempo completo |
| Operario de aseo – Yumbo | **PER_DIEM** | Por obra o labor | Tiempo completo |
| Conductor C1 | **PER_DIEM** | Por obra o labor | — |
| Conductor C2 | **PER_DIEM** | Por obra o labor | Tiempo completo |
| Conductor | **TEMPORARY** | Definido | Tiempo completo |
| Conductor bus institucional – Bogotá | **TEMPORARY** | Definido | Tiempo completo |
| Auxiliar contable y administrativo – norte de Bogotá | **TEMPORARY** | Definido | Tiempo completo |
| Auxiliar de almacén | **TEMPORARY** | Definido | Tiempo completo |
| Auxiliar de almacén (otra) | **TEMPORARY** | Definido | Tiempo completo |

12 de 12: obra o labor → `PER_DIEM`, definido → `TEMPORARY`, indefinido →
`FULL_TIME`. Ninguno sigue la jornada visible.

## 3. Pruebas y gates

Ver `tasks.md` §4; resultados en la descripción del PR.
