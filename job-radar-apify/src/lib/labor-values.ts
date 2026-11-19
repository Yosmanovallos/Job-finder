// Annual labor values and the rules the /herramientas calculators apply
// (openspec/changes/adsense-readiness F5, ADS-060). Every figure was read
// in an official .gov.co page on the date shown; the verbatim quotes are in
// openspec/changes/adsense-readiness/f5-fuentes-calculadoras.md.
//
// Yearly update (each January): replace the 2026 decrees with the new
// ones, change LABOR_VALUES_YEAR and the figures, re-read every source and
// update `consulted`. Until that is done the calculators refuse dates
// outside LABOR_VALUES_YEAR instead of applying last year's values.

export interface OfficialSource {
  label: string;
  url: string;
  /** YYYY-MM-DD when the page was read. */
  consulted: string;
}

export const LABOR_VALUES_YEAR = 2026;
const CONSULTED = "2026-11-18";

export const LABOR_VALUES = {
  /** Salario mínimo legal mensual vigente 2026, in pesos. */
  minimumWage: 1_750_905,
  /** Auxilio de transporte 2026, in pesos. */
  transportAllowance: 249_095,
  /** Paid to those who earn «hasta dos (2) veces» the minimum wage. */
  transportAllowanceMaxWages: 2,
  healthEmployeeRate: 0.04,
  pensionEmployeeRate: 0.04,
  /** Contribution base: at least 1 SMMLV; pension cap 25 SMMLV. */
  contributionBaseMaxWages: 25,
  /** Ley 100 art. 204 par. 3 lets the health base be capped at 20 SMMLV, so the net-salary calculator stops there. */
  netSalaryMaxBaseWages: 20,
  /** Salario integral contributes on 70 % of the salary. */
  integralContributionShare: 0.7,
  /** Salario integral: at least 10 SMMLV plus a factor prestacional of at least 30 %. */
  integralMinWages: 13,
  /** Art. 64 b): «igual o superior a diez (10)» SMMLV. */
  severanceHighWageThreshold: 10,
  severanceInterestRate: 0.12,
  vacationDaysPerYear: 15,
  primaDaysPerYear: 30,
  cesantiasDaysPerYear: 30,
  daysPerYear: 360
} as const;

export const LABOR_SOURCES = {
  minimumWage: {
    label: "Decreto 1469 de 2025 (salario mínimo 2026), normograma del Ministerio TIC",
    url: "https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_1469_2025.htm",
    consulted: CONSULTED
  },
  minimumWageTransitory: {
    label: "Decreto 159 de 2026 (fijación transitoria, misma cifra), normograma del Ministerio TIC",
    url: "https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_0159_2026.htm",
    consulted: CONSULTED
  },
  transportAllowance: {
    label: "Decreto 1470 de 2025 (auxilio de transporte 2026), normograma del Ministerio TIC",
    url: "https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_1470_2025.htm",
    consulted: CONSULTED
  },
  laborCode: {
    label: "Código Sustantivo del Trabajo (arts. 64, 132, 186, 189, 249 y 306), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983",
    consulted: CONSULTED
  },
  severanceInterest: {
    label: "Decreto 1072 de 2015, art. 2.2.1.3.4 (intereses sobre cesantías), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=72173",
    consulted: CONSULTED
  },
  proportionalVacation: {
    label: "Ley 995 de 2005, art. 1 (vacaciones proporcionales), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=18192",
    consulted: CONSULTED
  },
  laborReform: {
    label: "Ley 2466 de 2025 (arts. 5, 6 y 64), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676",
    consulted: CONSULTED
  },
  transportInPrestaciones: {
    label: "Corte Suprema de Justicia, Sentencia 2994 de 1989 (Ley 1 de 1963, art. 7), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=88002",
    consulted: CONSULTED
  },
  days360: {
    label: "Función Pública, Concepto 328041 de 2021 (meses de 30 días y año de 360)",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=173870",
    consulted: CONSULTED
  },
  health: {
    label: "Ley 1122 de 2007, art. 10 (cotización en salud), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=22600",
    consulted: CONSULTED
  },
  healthBase: {
    label: "Ley 100 de 1993, art. 204 (base de cotización en salud), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=5248",
    consulted: CONSULTED
  },
  pensionRate: {
    label: "Decreto 4982 de 2007, art. 1 (cotización de pensión del 16 %), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=28144",
    consulted: CONSULTED
  },
  pension: {
    label: "Ley 797 de 2003, arts. 5, 7 y 8 (base, reparto y fondo de solidaridad pensional), Gestor Normativo de Función Pública",
    url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=7223",
    consulted: CONSULTED
  }
} satisfies Record<string, OfficialSource>;

export type LaborSourceKey = keyof typeof LABOR_SOURCES;

/** «1.750.905» — Colombian thousands separator, no decimals. */
export function formatPesos(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
