# F3 — 12 temas propuestos para `/guias` (pendiente de aprobación)

**Fecha:** 2026-11-14. **Estado:** propuesta. No se escribe ninguna guía
hasta que el propietario apruebe la lista.

Evidencia: `docs/seo-baseline/2026-11-keyword-study.md` (PR #121), §8.2
(volumen mensual Ubersuggest, Colombia) y §8.4 (páginas que traen tráfico a
la competencia). «Sin dato medido» significa que el estudio no midió esa
consulta. No se le asigna ninguna cifra.

| # | Tema y título de trabajo | Evidencia de demanda | Fuentes oficiales previstas | Dato propio del corpus (se mide al escribir) | Etiquetas |
|---|---|---|---|---|---|
| 1 | **Trabajo remoto desde Colombia**: cómo encontrarlo y qué dice la ley (remoto, teletrabajo, trabajo en casa) | «trabajo remoto» 40,5 K (SD 17); «trabajo desde casa» 14,8 K; «trabajo remoto colombia» 5,4 K | Ley 2121 de 2021, Ley 1221 de 2008, Ley 2088 de 2021 (Senado, Función Pública, Mintrabajo) | Vacantes remotas activas en Colombia (`modality=remoto`) | remoto, ofertas-falsas, contratos |
| 2 | **Trabajo sin experiencia**: cómo conseguir el primer empleo en Colombia | «trabajo sin experiencia bogota» 18,1 K; nacional 9,9 K; Cali 6,6 K; Medellín 4,4 K. La página n.º 1 de Computrabajo es «Bogotá sin experiencia» | Ley 1780 de 2016 (primer empleo), Ley 2039 de 2020 (prácticas como experiencia), SENA | Vacantes activas que dicen «sin experiencia», total y por ciudad | sin-experiencia, hoja-de-vida, servicio-publico-de-empleo |
| 3 | **Agencia Pública de Empleo del SENA**: cómo inscribirse y usarla | La página «agencia pública de empleo SENA» le trae 12,2 K visitas/mes a elempleo | SENA (APE), Unidad del Servicio Público de Empleo, Ley 1636 de 2013 | Vacantes activas en el corpus para los cargos que más ofrece el SENA, por ciudad | servicio-publico-de-empleo, sin-experiencia, buscar-empleo |
| 4 | **Medio tiempo, fines de semana y trabajo por días**: derechos, pagos y recargos | «trabajo fines de semana» 12,1 K; «medio tiempo medellin» 3,6 K; «medio tiempo cali» 2,4 K; «trabajo por días» 590 | Código Sustantivo del Trabajo; Ley 2466 de 2025 (reforma laboral: jornada y recargos); Mintrabajo | Vacantes activas de medio tiempo y de fin de semana (hubs de intención) | contratos, prestaciones, buscar-empleo |
| 5 | **Trabajo de temporada de fin de año**: contratos temporales y qué exigir | «trabajo de temporada» 590; la temporada de diciembre empieza ahora | CST (obra o labor, término fijo); Decreto 4369 de 2006 (empresas de servicios temporales); Mintrabajo | Vacantes activas de temporada (hub de intención) | contratos, prestaciones, sin-experiencia |
| 6 | **Tipos de contrato de trabajo en Colombia**: indefinido, fijo, obra o labor, prestación de servicios | Sin dato medido | CST arts. 22–23, 45–47; Ley 2466 de 2025; Función Pública (prestación de servicios) | Vacantes que nombran cada tipo de contrato en su texto. Se declara el límite: `employment_type` del corpus no es confiable y no se usa | contratos, prestaciones, entrevista |
| 7 | **Prestaciones sociales**: prima, cesantías, intereses y vacaciones | Sin dato medido | CST arts. 186, 249, 306; Ley 52 de 1975; decretos del salario mínimo y del auxilio de transporte 2026 | Vacantes que publican salario y en qué rango (con la cobertura real del campo) | prestaciones, contratos |
| 8 | **Periodo de prueba**: duración, cómo se pacta y qué pasa si te despiden | Sin dato medido | CST arts. 76–80 | Vacantes que mencionan periodo de prueba | contratos, sin-experiencia |
| 9 | **Liquidación del contrato**: qué incluye y cómo revisarla | Sin dato medido. Relacionada: «calculadora salarial» trae 5,0 K a elempleo | CST arts. 64, 65, 249, 306; Mintrabajo | Vacantes activas por tipo de contrato (con el mismo límite que el tema 6) | prestaciones, contratos |
| 10 | **Ofertas de empleo falsas**: señales para reconocerlas y dónde denunciar | Sin dato medido | Unidad del Servicio Público de Empleo (cobros prohibidos), Mintrabajo, Policía Nacional (CAI virtual), SIC | Cuántas vacantes del corpus vienen del portal oficial del empleador, y cómo reportar una en BuscoTrabajo | ofertas-falsas, buscar-empleo |
| 11 | **Cómo hacer una hoja de vida en Colombia** | Sin dato medido | Formato único de hoja de vida de Función Pública (sector público); Ley 1581 de 2012 (datos personales: qué no hace falta incluir) | Requisitos que más piden las vacantes activas para cargos de entrada | hoja-de-vida, sin-experiencia |
| 12 | **Entrevista de trabajo**: cómo prepararla y qué no te pueden preguntar | Sin dato medido | Servicio Público de Empleo (ruta de empleabilidad); Ley 1010 de 2006 y Ley 1257 de 2008, que tratan discriminación en el trabajo | Cargos con más vacantes activas en el corpus | entrevista, hoja-de-vida |

## Orden propuesto

Primero los que tienen demanda medida y hub propio (1, 2, 3, 4, 5); después
el bloque laboral (6–9); al final 10–12. Las 12 se preparan antes de la
primera solicitud. Después, 2 por semana.

## Riesgos por tema

- **Tema 12:** hay pocas fuentes oficiales sobre entrevistas. Si al
  verificar no alcanzan para sostener el texto, se cambia por «salario
  mínimo y auxilio de transporte 2026».
- **Temas 6 y 9:** el campo de tipo de contrato del corpus no es confiable
  (hallazgo de la ola de intención 2, PR #129). El dato propio
  sale de búsquedas de texto y se dice cómo se midió.
- **Ley 2466 de 2025:** se verifica artículo por artículo en el texto
  oficial, sobre todo los cambios que entran por etapas (recargo dominical,
  jornada).

## Decisiones que necesito del propietario

1. Aprobar, quitar o cambiar temas de la lista.
2. **Autor** que aparece en cada guía y en su JSON-LD `Article`: una persona
   con nombre real (pendiente D2) o «Equipo de BuscoTrabajo» como
   organización.
3. **Quién firma** (`revisado_por`) cada guía (D3).
