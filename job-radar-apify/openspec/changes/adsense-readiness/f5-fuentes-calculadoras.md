# F5: fuentes verificadas de las calculadoras (2026-11-18)

Cada valor y regla que usan `/herramientas/calculadora-de-liquidacion` y
`/herramientas/calculadora-salario-neto` se leyó en una fuente oficial
`.gov.co` el 2026-11-18. Las páginas se descargaron con `curl` y el texto se
buscó directamente, sin resúmenes. `secretariasenado.gov.co` rechazó la
conexión (ECONNREFUSED) y `mintrabajo.gov.co` respondió 503 desde este
entorno, por eso se citan Función Pública y el normograma del MinTIC.

Los valores viven en `src/lib/labor-values.ts`.

## Valores de 2026

| Valor | Cifra | Fuente | Texto leído |
|---|---|---|---|
| Salario mínimo mensual 2026 | $1.750.905 | Decreto 1469 de 2025 (D.O. 53.350, 29-dic-2025), [normograma MinTIC](https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_1469_2025.htm) | art. 1: «la suma de UN MILLÓN SETECIENTOS CINCUENTA MIL NOVECIENTOS CINCO PESOS ($1.750.905)»; art. 2: «rige a partir del primero (1o.) de enero de 2026» |
| (mismo valor, transitorio) | $1.750.905 | Decreto 159 de 2026 (D.O. 53.403, 19-feb-2026), [normograma MinTIC](https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_0159_2026.htm) | Nota de vigencia: «Decreto cumplió su objeto al levantarse la medida de suspensión del Decreto 1469» |
| Auxilio de transporte 2026 | $249.095, hasta 2 SMMLV | Decreto 1470 de 2025 (D.O. 53.350), [normograma MinTIC](https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_1470_2025.htm) | art. 1: «trabajadores particulares que devengan hasta dos (2) veces el Salario Mínimo […] ($249.095)» |

El Consejo de Estado suspendió el Decreto 1469 (auto del 12-feb-2026) y el
Gobierno dictó el 159 con la misma cifra. Según la nota de vigencia del
normograma, la suspensión se levantó. Las dos normas dan $1.750.905.

## Reglas de liquidación

| Regla | Fuente | Texto leído |
|---|---|---|
| Prima: 30 días por año, por semestre o en proporción | CST art. 306 (mod. Ley 1788 de 2016), [Función Pública i=199983](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983) | «corresponderá a 30 días de salario por año […] proporcionalmente al tiempo trabajado» |
| Cesantías: un mes por año y en proporción | CST art. 249 | «un mes de salario por cada año de servicios y proporcionalmente por fracción de año» |
| Intereses: 12 % anual, en proporción si termina antes del 31-dic | Decreto 1072 de 2015 art. 2.2.1.3.4, [Función Pública i=72173](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=72173) | «intereses del 12% anual sobre los saldos […] en cuantía proporcional al lapso transcurrido del año» |
| Vacaciones: 15 días hábiles por año | CST art. 186 | «quince (15) días hábiles consecutivos de vacaciones remuneradas» |
| Vacaciones: compensación proporcional, cualquiera que sea el tiempo | Ley 995 de 2005 art. 1, [Función Pública i=18192](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=18192) | «se les reconozcan y compensen en dinero proporcionalmente por el tiempo efectivamente trabajado» |
| Vacaciones: base = último salario | CST art. 189 num. 3 | «se tomará como base el último salario devengado por el trabajador» |
| Auxilio en la base de cesantías e intereses | Ley 2466 de 2025 art. 64 (parágrafos al art. 99 Ley 50), [Función Pública i=260676](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676) | «salario base de liquidación compuesto por el salario mensual sumado al auxilio de transporte en los casos en que a este hubiere lugar» |
| Auxilio en la base de prestaciones, y solo de prestaciones | Ley 1 de 1963 art. 7, citada por la Corte Suprema, Sentencia 2994 de 1989, [Función Pública i=88002](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=88002) | «quedó incorporado al salario para todos los efectos de liquidaciones de prestaciones sociales»; la misma sentencia dice que la regla es limitativa. No se encontró el texto de la Ley 1 de 1963 en una fuente oficial; se cita la sentencia |
| Indemnización sin justa causa | CST art. 64 (mod. Ley 789 de 2002 art. 28) | fijo: «salarios correspondientes al tiempo que faltare»; obra: «no será inferior a quince (15) días»; indefinido a) < 10 SMMLV: 30 días el primer año y 20 por cada año siguiente «y proporcionalmente por fracción»; b) «igual o superior a diez (10)»: 20 y 15 |
| Parágrafo transitorio del art. 64 | CST art. 64 | quienes tenían 10 o más años al entrar en vigencia la Ley 789 conservan la tabla de la Ley 50: la calculadora no calcula la indemnización si el contrato empezó antes de 1993 |
| Salario integral | CST art. 132 | mínimo «diez (10) salarios mínimos […] más el factor prestacional […] no podrá ser inferior al treinta por ciento (30%)»; compensa primas, cesantías e intereses, «excepto las vacaciones» |
| Año de 360 días, meses de 30 | Concepto 328041 de 2021, Función Pública, [i=173870](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=173870) | «tomando todos los meses como sí estos fueran de 30 días, como consecuencia el año sería de 360 días». Es un criterio, no una norma: la página lo dice |

### Ley 2466 de 2025

Se buscaron en el texto de la ley todos los «Modifíquese el artículo … del
Código Sustantivo del Trabajo». Modifica los arts. 3, 4, 23, 34, 46, 47, 81,
115, 120, 160, 161, 162, 179, 362 y 488, y adiciona 57, 59, 59A y 81A. **No
modifica los arts. 64, 132, 186, 189, 249 ni 306.** Lo aplicable:

- art. 6 (CST art. 46): en término fijo y obra o labor, «derecho al pago de
  vacaciones y prestaciones sociales en proporción al tiempo laborado
  cualquiera que este sea».
- art. 5 (CST art. 47): preaviso de 30 días para la renuncia en el contrato
  indefinido; no aplica si la causa es imputable al empleador.
- art. 64 (Ley 50 art. 99): base de cesantías e intereses con auxilio
  (arriba).

## Reglas de salario neto

| Regla | Fuente | Texto leído |
|---|---|---|
| Salud: 4 % a cargo del trabajador | Ley 1122 de 2007 art. 10, [Función Pública i=22600](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=22600) | «del 12,5% […] a cargo del empleador será del 8.5% y a cargo del empleado del 4%» |
| Salud: misma base que pensión | Ley 100 de 1993 art. 204 par. 1, [Función Pública i=5248](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=5248) | «será la misma contemplada en el Sistema General de Pensiones». El par. 3 permite limitarla a 20 SMMLV: por eso la calculadora llega hasta una base de 20 SMMLV |
| Pensión: 16 % total | Decreto 4982 de 2007 art. 1, [Función Pública i=28144](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=28144) | «a partir del 1° de enero del año 2008, la tasa de cotización […] será del 16%» |
| Pensión: 25 % a cargo del trabajador (4 %) | Ley 797 de 2003 art. 7, [Función Pública i=7223](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=7223) | «Los empleadores pagarán el 75% de la cotización total y los trabajadores el 25% restante» |
| Base: mínimo 1 SMMLV, tope 25; integral sobre el 70 % | Ley 797 de 2003 art. 5 | «límite de la base de cotización será de veinticinco (25)»; «se calculará sobre el 70% de dicho salario»; «En ningún caso […] inferior a un salario mínimo» |
| Fondo de solidaridad pensional | Ley 797 de 2003 arts. 7 y 8 | 1 % con ingreso «igual o superior a cuatro (4)»; adicional «de 16 a 17 smlmv de un 0.2%, de 17 a 18 smlmv de un 0.4%, de 18 a 19 smlmv de un 0.6%, de 19 a 20 smlmv de un 0.8% y superiores a 20 smlmv de 1%» |

Cómo se leen los bordes de los tramos (decisión documentada en la página y
en las pruebas): cada tramo incluye su límite inferior; 20 SMMLV exactos
caen en el 0,8 % porque solo «superiores a 20» pagan el 1 %.

## Lo que no se calcula

- **Retención en la fuente:** depende de la depuración de cada persona
  (dependientes, intereses de vivienda, medicina prepagada, aportes
  voluntarios, rentas exentas con topes en UVT, art. 383 del Estatuto
  Tributario). No se verificó la UVT 2026 ni el procedimiento completo; la
  página lo dice y no da una cifra.
- **Ley 2381 de 2024 (reforma pensional):** no se verificó su fecha de
  entrada en vigencia en una fuente oficial. La página dice que usa las
  reglas vigentes de la Ley 100 y la Ley 797 para 2026.
- **Bases variables** (comisiones, horas extra): la calculadora supone un
  salario fijo y lo dice.
