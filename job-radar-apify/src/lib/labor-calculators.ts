// Deterministic labor calculators for /herramientas (adsense-readiness F5,
// ADS-060). Pure functions: no I/O, no clock, no storage. They run in the
// visitor's browser and nothing typed into them leaves it. The values and
// their official sources live in labor-values.ts; the hand-solved cases
// are in tests/validate-labor-calculators.test.ts.
//
// Conventions shared by every amount:
// - year of 360 days and months of 30 (Función Pública, Concepto 328041
//   de 2021), counting both the first and the last day;
// - each line is rounded to the peso, and the interest is computed from
//   the rounded cesantías shown on screen, so every line can be redone by
//   hand from what the page displays.

import { LABOR_VALUES, LABOR_VALUES_YEAR, formatPesos, type LaborSourceKey } from "./labor-values.js";

export interface PlainDate {
  y: number;
  m: number;
  d: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(y: number, m: number): number {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** "YYYY-MM-DD" as integers. Never goes through Date, so the time zone cannot shift the day. */
export function parseIsoDate(value: string): PlainDate | null {
  const match = ISO_DATE_RE.exec(value ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function compareDates(a: PlainDate, b: PlainDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

function day30(date: PlainDate): number {
  // The 31st and the last day of February count as day 30.
  return date.d >= 30 || date.d === daysInMonth(date.y, date.m) ? 30 : date.d;
}

/** Days between two dates, both included, with 30-day months. */
export function days360(start: PlainDate, end: PlainDate): number {
  return (end.y - start.y) * 360 + (end.m - start.m) * 30 + (day30(end) - day30(start)) + 1;
}

function laterOf(a: PlainDate, b: PlainDate): PlainDate {
  return compareDates(a, b) >= 0 ? a : b;
}

function isFiniteMoney(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export type SalaryType = "ordinario" | "integral";
export type ContractType = "indefinido" | "fijo" | "obra";
export type Termination = "renuncia" | "despido_sin_justa_causa" | "justa_causa" | "vencimiento";

export interface LiquidationInput {
  salary: number;
  salaryType: SalaryType;
  /** The worker is paid the auxilio (false for teletrabajo or when the employer provides transport). */
  transportAllowance: boolean;
  contractType: ContractType;
  startDate: string;
  endDate: string;
  termination: Termination;
  /** Vacation days already enjoyed or paid during the whole contract. */
  vacationDaysTaken: number;
  /** Término fijo: the end date agreed in the contract. */
  agreedEndDate?: string;
  /** Obra o labor: days that were left to finish the work, as estimated by the worker. */
  remainingDaysObra?: number;
}

export interface CalcLine {
  key: "prima" | "cesantias" | "intereses" | "vacaciones";
  label: string;
  amount: number;
  /** The arithmetic with the person's own numbers, e.g. «2.000.000 × 180 ÷ 360». */
  formula: string;
  source: LaborSourceKey;
}

export interface LiquidationResult {
  days: { total: number; prima: number; cesantias: number };
  prestacionesBase: number;
  transportApplied: boolean;
  vacationDaysPending: number;
  lines: CalcLine[];
  indemnization: { days: number; amount: number; formula: string } | null;
  total: number;
  notes: string[];
}

export type CalcError = { error: string };

const SEVERANCE_TRANSITION_START: PlainDate = { y: 1993, m: 1, d: 1 };

function decimal(value: number, digits = 2): string {
  return value.toLocaleString("es-CO", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function money(value: number): string {
  return formatPesos(value).slice(1);
}

/** Whether the auxilio de transporte applies: ordinary salary of at most 2 SMMLV and the worker says it is paid. */
function transportApplies(salary: number, salaryType: SalaryType, paid: boolean): boolean {
  return paid && salaryType === "ordinario" && salary <= LABOR_VALUES.transportAllowanceMaxWages * LABOR_VALUES.minimumWage;
}

function validateSalary(salary: number, salaryType: SalaryType): string | null {
  const { minimumWage, integralMinWages } = LABOR_VALUES;
  if (!isFiniteMoney(salary)) return "Escribe tu salario mensual en pesos, sin puntos ni comas.";
  if (salaryType === "integral" && salary < integralMinWages * minimumWage) {
    return `El salario integral no puede ser menor a 13 salarios mínimos (${formatPesos(integralMinWages * minimumWage)} en ${LABOR_VALUES_YEAR}): 10 salarios más un factor prestacional de al menos 30 % (CST art. 132).`;
  }
  if (salaryType === "ordinario" && salary < minimumWage) {
    return `La calculadora supone jornada completa, y en ${LABOR_VALUES_YEAR} el salario mínimo es ${formatPesos(minimumWage)}. Si trabajas por horas o por días, el cálculo es distinto.`;
  }
  return null;
}

export function computeLiquidation(input: LiquidationInput): LiquidationResult | CalcError {
  const { minimumWage, daysPerYear, severanceInterestRate, vacationDaysPerYear, severanceHighWageThreshold } = LABOR_VALUES;
  const salaryError = validateSalary(input.salary, input.salaryType);
  if (salaryError) return { error: salaryError };
  const start = parseIsoDate(input.startDate);
  const end = parseIsoDate(input.endDate);
  if (!start || !end) return { error: "Escribe la fecha de inicio y la de terminación del contrato." };
  if (compareDates(start, end) > 0) return { error: "La fecha de terminación no puede ser anterior a la de inicio." };
  if (end.y !== LABOR_VALUES_YEAR) {
    return { error: `Esta calculadora usa los valores de ${LABOR_VALUES_YEAR}, así que la fecha de terminación debe estar en ${LABOR_VALUES_YEAR}.` };
  }
  const taken = input.vacationDaysTaken;
  if (typeof taken !== "number" || !Number.isFinite(taken) || taken < 0) {
    return { error: "Escribe los días de vacaciones que ya disfrutaste (0 si ninguno)." };
  }

  const salary = Math.round(input.salary);
  const integral = input.salaryType === "integral";
  const transportApplied = transportApplies(salary, input.salaryType, input.transportAllowance);
  const prestacionesBase = salary + (transportApplied ? LABOR_VALUES.transportAllowance : 0);
  const totalDays = days360(start, end);
  const semesterStart: PlainDate = { y: end.y, m: end.m <= 6 ? 1 : 7, d: 1 };
  const yearStart: PlainDate = { y: end.y, m: 1, d: 1 };
  const primaDays = days360(laterOf(start, semesterStart), end);
  const cesantiasDays = days360(laterOf(start, yearStart), end);
  const notes: string[] = [];
  const lines: CalcLine[] = [];

  if (!integral) {
    const prima = Math.round((prestacionesBase * primaDays) / daysPerYear);
    const cesantias = Math.round((prestacionesBase * cesantiasDays) / daysPerYear);
    const intereses = Math.round((cesantias * cesantiasDays * severanceInterestRate) / daysPerYear);
    lines.push(
      { key: "prima", label: "Prima de servicios", amount: prima, formula: `${money(prestacionesBase)} × ${primaDays} ÷ 360`, source: "laborCode" },
      { key: "cesantias", label: "Cesantías", amount: cesantias, formula: `${money(prestacionesBase)} × ${cesantiasDays} ÷ 360`, source: "laborCode" },
      { key: "intereses", label: "Intereses sobre cesantías", amount: intereses, formula: `${money(cesantias)} × ${cesantiasDays} × 12 % ÷ 360`, source: "severanceInterest" }
    );
  } else {
    notes.push("Con salario integral no hay prima, cesantías ni intereses: el factor prestacional ya los pagó mes a mes (CST art. 132). Las vacaciones sí se liquidan.");
  }

  const accrued = (totalDays * vacationDaysPerYear) / daysPerYear;
  const pending = Math.max(0, accrued - taken);
  const vacaciones = Math.round((salary / 30) * pending);
  lines.push({
    key: "vacaciones",
    label: "Vacaciones no disfrutadas",
    amount: vacaciones,
    formula: `${money(salary)} ÷ 30 × ${decimal(pending)} días`,
    source: "proportionalVacation"
  });
  if (taken > accrued) notes.push("Los días de vacaciones que escribiste superan los causados, así que no quedan vacaciones por pagar.");

  let indemnization: LiquidationResult["indemnization"] = null;
  if (input.termination === "despido_sin_justa_causa") {
    const daily = salary / 30;
    if (input.contractType === "fijo") {
      const agreed = parseIsoDate(input.agreedEndDate ?? "");
      if (!agreed) return { error: "Para un contrato a término fijo, escribe la fecha de terminación pactada en el contrato." };
      if (compareDates(agreed, end) <= 0) {
        notes.push("La fecha pactada ya se cumplió: el contrato terminó por vencimiento del plazo y no hay indemnización.");
      } else {
        const days = days360(end, agreed) - 1;
        indemnization = { days, amount: Math.round(daily * days), formula: `${money(salary)} ÷ 30 × ${days} días que faltaban` };
      }
    } else if (input.contractType === "obra") {
      const remaining = input.remainingDaysObra;
      if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) {
        return { error: "Para un contrato por obra o labor, escribe cuántos días faltaban para terminar la obra (0 si no lo sabes)." };
      }
      const days = Math.max(15, remaining);
      indemnization = { days, amount: Math.round(daily * days), formula: `${money(salary)} ÷ 30 × ${decimal(days)} días (mínimo 15)` };
      if (remaining < 15) notes.push("En obra o labor la indemnización no puede ser menor a 15 días de salario (CST art. 64).");
    } else if (compareDates(start, SEVERANCE_TRANSITION_START) < 0) {
      notes.push("Si tu contrato empezó antes de 1993, puede aplicarte la tabla de indemnización de la Ley 50 de 1990 (parágrafo transitorio del art. 64 del CST). Esta calculadora no la cubre: consulta tu caso con el Ministerio del Trabajo.");
    } else {
      const high = salary >= severanceHighWageThreshold * minimumWage;
      const [first, extra] = high ? [20, 15] : [30, 20];
      const years = totalDays / daysPerYear;
      const days = years <= 1 ? first : first + extra * (years - 1);
      indemnization = {
        days,
        amount: Math.round(daily * days),
        formula: years <= 1
          ? `${money(salary)} ÷ 30 × ${first} días`
          : `${money(salary)} ÷ 30 × (${first} + ${extra} × ${decimal(years - 1, 4)} años) = ${decimal(days, 4)} días`
      };
    }
  }
  if (input.termination === "renuncia" && input.contractType === "indefinido") {
    notes.push("Si renunciaste a un contrato indefinido, la ley pide avisar con 30 días; si la causa fue imputable al empleador, no hay preaviso y podrías reclamar la indemnización (Ley 2466 de 2025, art. 5).");
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0) + (indemnization?.amount ?? 0);
  return {
    days: { total: totalDays, prima: integral ? 0 : primaDays, cesantias: integral ? 0 : cesantiasDays },
    prestacionesBase: integral ? 0 : prestacionesBase,
    transportApplied,
    vacationDaysPending: pending,
    lines,
    indemnization,
    total,
    notes
  };
}

export interface NetSalaryInput {
  salary: number;
  salaryType: SalaryType;
  transportAllowance: boolean;
}

export interface NetSalaryResult {
  ibc: number;
  ibcInWages: number;
  health: number;
  pension: number;
  solidarity: number;
  solidarityRate: number;
  transport: number;
  net: number;
}

/**
 * Fondo de solidaridad pensional rate (Ley 797 de 2003, arts. 7 y 8) for a
 * contribution base. Each bracket includes its lower limit; exactly 20
 * SMMLV stays at 0,8 % extra because only «superiores a 20» pay 1 %.
 * Compared in whole pesos to avoid floating-point edges.
 */
export function solidarityRate(ibc: number, minimumWage: number): number {
  if (ibc < 4 * minimumWage) return 0;
  if (ibc < 16 * minimumWage) return 0.01;
  if (ibc < 17 * minimumWage) return 0.012;
  if (ibc < 18 * minimumWage) return 0.014;
  if (ibc < 19 * minimumWage) return 0.016;
  if (ibc <= 20 * minimumWage) return 0.018;
  return 0.02;
}

export function computeNetSalary(input: NetSalaryInput): NetSalaryResult | CalcError {
  const { minimumWage, healthEmployeeRate, pensionEmployeeRate, integralContributionShare, netSalaryMaxBaseWages } = LABOR_VALUES;
  const salaryError = validateSalary(input.salary, input.salaryType);
  if (salaryError) return { error: salaryError };
  const salary = Math.round(input.salary);
  const ibc = Math.max(minimumWage, Math.round(input.salaryType === "integral" ? salary * integralContributionShare : salary));
  if (ibc > netSalaryMaxBaseWages * minimumWage) {
    return {
      error: `Tu base de cotización supera 20 salarios mínimos (${formatPesos(netSalaryMaxBaseWages * minimumWage)}). Desde ahí la ley permite topes distintos para salud y pensión, y la calculadora no adivina cuál aplica tu empleador.`
    };
  }
  const rate = solidarityRate(ibc, minimumWage);
  const health = Math.round(ibc * healthEmployeeRate);
  const pension = Math.round(ibc * pensionEmployeeRate);
  const solidarity = Math.round(ibc * rate);
  const transport = transportApplies(salary, input.salaryType, input.transportAllowance) ? LABOR_VALUES.transportAllowance : 0;
  return {
    ibc,
    ibcInWages: ibc / minimumWage,
    health,
    pension,
    solidarity,
    solidarityRate: rate,
    transport,
    net: salary - health - pension - solidarity + transport
  };
}
