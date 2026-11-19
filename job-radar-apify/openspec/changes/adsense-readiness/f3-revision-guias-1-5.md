# F3 — Revisión de las guías 1–5 (para el propietario)

Borradores en `content/guias/`. Todos están en `revision_propietario:
pendiente`: ninguno se publica todavía. Cada cifra o norma tiene su fuente
enlazada al final del archivo, y el validador (`npx tsx
scripts/validate-guides-content.ts`) las pasa todas.

## Cómo aprobar

Una guía a la vez, en el chat: «Apruebo `<slug>`» (o «apruebo con estos
cambios: …»). Con eso se escribe en la guía:

```
revision_propietario: aprobada
revisado_por: Equipo de BuscoTrabajo
fecha_revision: <fecha de tu aprobación>
```

`publicada` y `actualizada` quedan vacías hasta el commit que encienda
`GUIDES_ENABLED` y salga a producción; ahí se pone la fecha real de
despliegue. Antes de ese commit se vuelven a medir las cifras del corpus.
Una guía aprobada sin fecha de publicación no aparece en el sitio.

## Qué revisar con más cuidado

Son las frases que dependen de una interpretación o de un cálculo, no de
copiar la norma. Si alguna no te convence, se cambia o se quita.

### 1. `trabajo-remoto-colombia` (1.471 palabras útiles)

- Distingue tres figuras: trabajo remoto (Ley 2121 de 2021), teletrabajo
  (Ley 1221 de 2008, con la reforma de 2025) y trabajo en casa (Ley 2088 de
  2021). Dice que un anuncio de «trabajo en casa» permanente en realidad
  describe teletrabajo o trabajo remoto. Es una lectura de las definiciones.
- Auxilio de conectividad: en teletrabajo, «menos de dos» salarios mínimos;
  en trabajo en casa, «hasta dos». Es la diferencia literal entre las dos
  leyes.
- Cita 2.771 vacantes remotas (API) y 710 en la página de empleos remotos, y
  explica que la página solo lista las aptas para página propia.

### 2. `trabajo-sin-experiencia` (1.081)

- Apoyo de sostenimiento del aprendiz: 75 % / 100 % del mínimo según fase,
  y mínimo un salario para universitarios (art. 81 del CST según la Ley
  2466 de 2025).
- Exención de aportes a Caja de Compensación por contratar a personas de 18
  a 28 años durante el primer año, con condiciones (Ley 1780 de 2016, art.
  7). La guía lo presenta como argumento para la persona que busca empleo.

### 3. `agencia-publica-de-empleo-sena` (1.121)

- «Todo es gratis para quien busca empleo»: se apoya en el art.
  2.2.6.1.2.4 del Decreto 1072 (servicios básicos gratuitos) y en el portal
  de la APE. Los servicios especializados pueden tener otras reglas; la guía
  no dice que todo servicio de cualquier prestador sea gratis.
- Describe el Mecanismo de Protección al Cesante en términos generales
  (Ley 1636 de 2013, arts. 12 y 13) y remite a la Caja de Compensación.

### 4. `medio-tiempo-fines-de-semana-por-dias` (1.235)

- Recargo dominical y festivo: dice que en noviembre de 2026 el mínimo
  según el calendario gradual es el 90 % (Ley 2466, art. 14). Es un cálculo
  sobre las fechas de la ley.
- Jornada nocturna desde las 7 p. m. «seis meses después de la sanción»
  (25 de junio de 2025). No se pone la fecha exacta porque la ley no la da.
- Reducción a 42 horas: describe el calendario de la Ley 2101 sin fechas
  exactas, porque el Gestor Normativo no muestra la fecha de entrada en
  vigencia.
- Cotización por semanas para quien trabaja menos de 30 días al mes y gana
  menos de un mínimo (Decreto 1072, antes Decreto 2616 de 2013). No
  menciona salud, porque esa sección no la cubre.

### 5. `trabajo-de-temporada` (1.185)

- Ejemplo: en un contrato de cinco semanas el periodo de prueba no podría
  pasar de una semana (quinta parte, CST art. 78).
- Indemnización por falta de pago (CST art. 65): se dice que sus topes
  cambian según se gane más o menos de un mínimo, sin detallar la regla.
- Empresas de servicios temporales: casos permitidos y plazo de 6 + 6 meses
  (Decreto 1072, art. 2.2.6.5.6) y los parágrafos que añadió la Ley 2466 al
  art. 77 de la Ley 50 de 1990.

## Fuentes y método

Ver `f3-datos-corpus-2026-11-14.md` para las cifras del corpus, cómo se
midieron y qué cuenta cada hub, y los identificadores de cada norma en el
Gestor Normativo de Función Pública.
