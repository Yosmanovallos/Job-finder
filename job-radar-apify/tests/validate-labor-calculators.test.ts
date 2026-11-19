import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeLiquidation,
  computeNetSalary,
  days360,
  parseIsoDate,
  solidarityRate,
  type LiquidationInput,
  type LiquidationResult,
  type NetSalaryResult
} from "../src/lib/labor-calculators.js";
import { LABOR_SOURCES, LABOR_VALUES, LABOR_VALUES_YEAR } from "../src/lib/labor-values.js";

// openspec/changes/adsense-readiness F5 (ADS-060). Every expected amount
// below was worked out by hand from the formula written next to it, with
// the 2026 values verified in f5-fuentes-calculadoras.md:
//   SMMLV 1.750.905 · auxilio de transporte 249.095 · year of 360 days.

const SMMLV = 1_750_905;
const AUX = 249_095;
const here = path.dirname(fileURLToPath(import.meta.url));

function ok<T extends LiquidationResult | NetSalaryResult>(result: T | { error: string }): T {
  if ("error" in result) assert.fail(`unexpected error: ${result.error}`);
  return result;
}
function amount(result: LiquidationResult, key: string): number {
  const line = result.lines.find((item) => item.key === key);
  assert.ok(line, `line ${key} present`);
  return line.amount;
}
const base: LiquidationInput = {
  salary: SMMLV,
  salaryType: "ordinario",
  transportAllowance: true,
  contractType: "fijo",
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  termination: "renuncia",
  vacationDaysTaken: 0
};

test("F5 values: 2026 figures and their official sources", () => {
  assert.equal(LABOR_VALUES_YEAR, 2026);
  assert.equal(LABOR_VALUES.minimumWage, SMMLV);
  assert.equal(LABOR_VALUES.transportAllowance, AUX);
  assert.equal(LABOR_VALUES.transportAllowanceMaxWages, 2);
  assert.equal(LABOR_VALUES.healthEmployeeRate, 0.04);
  assert.equal(LABOR_VALUES.pensionEmployeeRate, 0.04);
  for (const [key, source] of Object.entries(LABOR_SOURCES)) {
    assert.match(new URL(source.url).hostname, /\.gov\.co$/, `${key} cites a .gov.co page`);
    assert.match(source.consulted, /^\d{4}-\d{2}-\d{2}$/, `${key} has a consultation date`);
    assert.ok(source.label.length > 5, `${key} has a readable label`);
  }
});

test("F5 dates: parsed as plain integers, never through the local time zone", () => {
  assert.deepEqual(parseIsoDate("2026-06-30"), { y: 2026, m: 6, d: 30 });
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.equal(parseIsoDate("2026-6-30"), null);
  assert.equal(parseIsoDate(""), null);
});

test("F5 days360: 30-day months, inclusive of both ends", () => {
  const d = (s: string) => parseIsoDate(s)!;
  assert.equal(days360(d("2026-01-01"), d("2026-06-30")), 180);
  assert.equal(days360(d("2026-01-01"), d("2026-12-31")), 360, "the 31st counts as the 30th");
  assert.equal(days360(d("2026-03-01"), d("2026-03-31")), 30);
  assert.equal(days360(d("2026-02-01"), d("2026-02-28")), 30, "a full February is 30 days");
  assert.equal(days360(d("2028-02-01"), d("2028-02-29")), 30, "leap-year February too");
  assert.equal(days360(d("2026-05-10"), d("2026-05-10")), 1, "start = end is one day");
  assert.equal(days360(d("2023-03-15"), d("2026-09-30")), 1276);
  assert.equal(days360(d("2026-02-01"), d("2026-08-15")), 195);
});

test("F5 liquidación: minimum wage with auxilio, 6 months, renuncia", () => {
  // base de prestaciones = 1.750.905 + 249.095 = 2.000.000
  const r = ok(computeLiquidation(base));
  assert.equal(r.days.total, 180);
  assert.equal(r.prestacionesBase, 2_000_000);
  assert.equal(amount(r, "prima"), 1_000_000); // 2.000.000 × 180 / 360
  assert.equal(amount(r, "cesantias"), 1_000_000); // 2.000.000 × 180 / 360
  assert.equal(amount(r, "intereses"), 60_000); // 1.000.000 × 180 × 12 % / 360
  assert.equal(amount(r, "vacaciones"), 437_726); // 1.750.905 × 180 / 720 = 437.726,25
  assert.equal(r.indemnization, null, "renuncia: no indemnización");
  assert.equal(r.total, 2_497_726);
});

test("F5 liquidación: minimum wage without auxilio (teletrabajo or transport provided)", () => {
  const r = ok(computeLiquidation({ ...base, transportAllowance: false }));
  assert.equal(r.prestacionesBase, SMMLV);
  assert.equal(amount(r, "prima"), 875_453); // 1.750.905 × 180 / 360 = 875.452,5
  assert.equal(amount(r, "cesantias"), 875_453);
  assert.equal(amount(r, "intereses"), 52_527); // 875.453 × 180 × 12 % / 360 = 52.527,18
  assert.equal(amount(r, "vacaciones"), 437_726);
  assert.equal(r.total, 875_453 + 875_453 + 52_527 + 437_726);
});

test("F5 liquidación: auxilio is ignored above 2 SMMLV and allowed at exactly 2", () => {
  const above = ok(computeLiquidation({ ...base, salary: 4_000_000 }));
  assert.equal(above.prestacionesBase, 4_000_000);
  assert.equal(above.transportApplied, false);
  const limit = ok(computeLiquidation({ ...base, salary: 2 * SMMLV }));
  assert.equal(limit.transportApplied, true, "«hasta dos (2) veces» includes 2 SMMLV");
  assert.equal(limit.prestacionesBase, 2 * SMMLV + AUX);
});

test("F5 liquidación: indefinido 3,5 años, despido sin justa causa, 30 días de vacaciones tomadas", () => {
  const r = ok(computeLiquidation({
    salary: 4_000_000,
    salaryType: "ordinario",
    transportAllowance: true,
    contractType: "indefinido",
    startDate: "2023-03-15",
    endDate: "2026-09-30",
    termination: "despido_sin_justa_causa",
    vacationDaysTaken: 30
  }));
  assert.equal(r.days.total, 1276);
  assert.equal(r.days.prima, 90); // 1-jul a 30-sep
  assert.equal(r.days.cesantias, 270); // 1-ene a 30-sep
  assert.equal(amount(r, "prima"), 1_000_000); // 4.000.000 × 90 / 360
  assert.equal(amount(r, "cesantias"), 3_000_000); // 4.000.000 × 270 / 360
  assert.equal(amount(r, "intereses"), 270_000); // 3.000.000 × 270 × 12 % / 360
  // 1276 × 15 / 360 = 53,1667 días causados − 30 tomados = 23,1667
  assert.equal(Math.round(r.vacationDaysPending * 100) / 100, 23.17);
  assert.equal(amount(r, "vacaciones"), 3_088_889); // 4.000.000 / 30 × 23,1667
  // < 10 SMMLV: 30 + 20 × (1276/360 − 1) = 80,8889 días × 133.333,33
  assert.ok(r.indemnization);
  assert.equal(Math.round(r.indemnization.days * 10_000) / 10_000, 80.8889);
  assert.equal(r.indemnization.amount, 10_785_185);
  assert.equal(r.total, 1_000_000 + 3_000_000 + 270_000 + 3_088_889 + 10_785_185);
});

test("F5 liquidación: renuncia vs despido on the same contract only changes the indemnización", () => {
  const input: LiquidationInput = { ...base, salary: 4_000_000, contractType: "indefinido", startDate: "2023-03-15", endDate: "2026-09-30", vacationDaysTaken: 30 };
  const quit = ok(computeLiquidation({ ...input, termination: "renuncia" }));
  const fired = ok(computeLiquidation({ ...input, termination: "despido_sin_justa_causa" }));
  const cause = ok(computeLiquidation({ ...input, termination: "justa_causa" }));
  assert.equal(quit.indemnization, null);
  assert.equal(cause.indemnization, null);
  assert.equal(fired.total - quit.total, 10_785_185);
  assert.equal(quit.total, cause.total);
});

test("F5 liquidación: indefinido, first year and the 10 SMMLV threshold", () => {
  const short = ok(computeLiquidation({ ...base, contractType: "indefinido", startDate: "2026-03-01", endDate: "2026-08-30", termination: "despido_sin_justa_causa" }));
  assert.equal(short.indemnization?.days, 30, "≤ 1 año y < 10 SMMLV: 30 días");
  assert.equal(short.indemnization?.amount, 1_750_905);
  const high = ok(computeLiquidation({ ...base, salary: 10 * SMMLV, contractType: "indefinido", startDate: "2024-07-01", endDate: "2026-06-30", termination: "despido_sin_justa_causa" }));
  // «igual o superior a diez (10)»: 20 + 15 × (720/360 − 1) = 35 días × 583.635
  assert.equal(high.indemnization?.days, 35);
  assert.equal(high.indemnization?.amount, 20_427_225);
});

test("F5 liquidación: término fijo pays the time left; vencimiento pays none", () => {
  const input: LiquidationInput = { ...base, salary: 2_500_000, startDate: "2026-02-01", endDate: "2026-08-15", agreedEndDate: "2026-12-31", termination: "despido_sin_justa_causa" };
  const r = ok(computeLiquidation(input));
  assert.equal(r.days.total, 195);
  assert.equal(r.prestacionesBase, 2_749_095);
  assert.equal(amount(r, "prima"), 343_637); // 2.749.095 × 45 / 360 = 343.636,875
  assert.equal(amount(r, "cesantias"), 1_489_093); // 2.749.095 × 195 / 360 = 1.489.093,125
  assert.equal(amount(r, "intereses"), 96_791); // 1.489.093 × 195 × 12 % / 360 = 96.791,05
  assert.equal(amount(r, "vacaciones"), 677_083); // 2.500.000 × 195 / 720 = 677.083,33
  // 16-ago a 31-dic: 135 días × 83.333,33
  assert.equal(r.indemnization?.days, 135);
  assert.equal(r.indemnization?.amount, 11_250_000);
  const expired = ok(computeLiquidation({ ...input, endDate: "2026-12-31", termination: "vencimiento" }));
  assert.equal(expired.indemnization, null);
  assert.ok("error" in computeLiquidation({ ...input, agreedEndDate: undefined }), "despido in fijo needs the agreed end date");
});

test("F5 liquidación: obra o labor never pays less than 15 days", () => {
  const r = ok(computeLiquidation({ ...base, contractType: "obra", termination: "despido_sin_justa_causa", remainingDaysObra: 5 }));
  assert.equal(r.indemnization?.days, 15);
  assert.equal(r.indemnization?.amount, 875_453); // 1.750.905 / 30 × 15 = 875.452,5
  const longer = ok(computeLiquidation({ ...base, contractType: "obra", termination: "despido_sin_justa_causa", remainingDaysObra: 40 }));
  assert.equal(longer.indemnization?.days, 40);
  assert.equal(longer.indemnization?.amount, 2_334_540); // 1.750.905 / 30 × 40
});

test("F5 liquidación: salario integral has no prima, cesantías ni intereses, and keeps vacaciones", () => {
  const r = ok(computeLiquidation({
    salary: 30_000_000,
    salaryType: "integral",
    transportAllowance: true,
    contractType: "indefinido",
    startDate: "2025-01-01",
    endDate: "2026-06-30",
    termination: "despido_sin_justa_causa",
    vacationDaysTaken: 0
  }));
  assert.equal(r.transportApplied, false);
  assert.deepEqual(r.lines.map((line) => line.key), ["vacaciones"]);
  assert.equal(amount(r, "vacaciones"), 22_500_000); // 30.000.000 × 540 / 720
  // ≥ 10 SMMLV: 20 + 15 × 0,5 = 27,5 días × 1.000.000
  assert.equal(r.indemnization?.days, 27.5);
  assert.equal(r.indemnization?.amount, 27_500_000);
  assert.equal(r.total, 50_000_000);
  assert.ok(!("error" in computeLiquidation({ ...base, salaryType: "integral", salary: 13 * SMMLV })), "13 SMMLV exactos es el mínimo");
  assert.ok("error" in computeLiquidation({ ...base, salaryType: "integral", salary: 13 * SMMLV - 1 }));
});

test("F5 liquidación: vacaciones pendientes never go negative", () => {
  const r = ok(computeLiquidation({ ...base, vacationDaysTaken: 20 }));
  assert.equal(r.vacationDaysPending, 0);
  assert.equal(amount(r, "vacaciones"), 0);
});

test("F5 liquidación: invalid inputs are refused with a message", () => {
  const bad: Array<Partial<LiquidationInput>> = [
    { endDate: "2025-12-31" }, // values only valid for 2026
    { startDate: "2026-07-01", endDate: "2026-06-30" },
    { salary: SMMLV - 1 },
    { salary: Number.NaN },
    { startDate: "2026-02-30" },
    { vacationDaysTaken: -1 }
  ];
  for (const patch of bad) {
    const result = computeLiquidation({ ...base, ...patch });
    assert.ok("error" in result && result.error.length > 10, JSON.stringify(patch));
  }
  const old = ok(computeLiquidation({ ...base, contractType: "indefinido", startDate: "1990-05-01", termination: "despido_sin_justa_causa" }));
  assert.equal(old.indemnization, null, "art. 64 parágrafo transitorio: not computed");
  assert.ok(old.notes.some((note) => /1993/.test(note)));
});

test("F5 salario neto: minimum wage with and without auxilio", () => {
  const withAux = ok(computeNetSalary({ salary: SMMLV, salaryType: "ordinario", transportAllowance: true }));
  assert.equal(withAux.ibc, SMMLV);
  assert.equal(withAux.health, 70_036); // 1.750.905 × 4 % = 70.036,2
  assert.equal(withAux.pension, 70_036);
  assert.equal(withAux.solidarity, 0);
  assert.equal(withAux.transport, AUX);
  assert.equal(withAux.net, 1_859_928); // 1.750.905 − 140.072 + 249.095
  const without = ok(computeNetSalary({ salary: SMMLV, salaryType: "ordinario", transportAllowance: false }));
  assert.equal(without.net, 1_610_833);
});

test("F5 salario neto: fondo de solidaridad pensional by bracket", () => {
  const n2 = ok(computeNetSalary({ salary: 8_000_000, salaryType: "ordinario", transportAllowance: true }));
  assert.equal(n2.transport, 0);
  assert.equal(n2.solidarity, 80_000); // 1 %
  assert.equal(n2.net, 7_280_000);
  const n3 = ok(computeNetSalary({ salary: 30_000_000, salaryType: "ordinario", transportAllowance: false }));
  assert.equal(n3.solidarityRate, 0.014); // 17,13 SMMLV: 1 % + 0,4 %
  assert.equal(n3.solidarity, 420_000);
  assert.equal(n3.net, 27_180_000);
});

test("F5 salario neto: bracket edges include their lower limit; 20 SMMLV stays at 0,8 %", () => {
  assert.equal(solidarityRate(4 * SMMLV - 1, SMMLV), 0);
  assert.equal(solidarityRate(4 * SMMLV, SMMLV), 0.01);
  assert.equal(solidarityRate(16 * SMMLV - 1, SMMLV), 0.01);
  assert.equal(solidarityRate(16 * SMMLV, SMMLV), 0.012);
  assert.equal(solidarityRate(17 * SMMLV, SMMLV), 0.014);
  assert.equal(solidarityRate(18 * SMMLV, SMMLV), 0.016);
  assert.equal(solidarityRate(19 * SMMLV, SMMLV), 0.018);
  assert.equal(solidarityRate(20 * SMMLV, SMMLV), 0.018);
  assert.equal(solidarityRate(20 * SMMLV + 1, SMMLV), 0.02);
  const four = ok(computeNetSalary({ salary: 4 * SMMLV, salaryType: "ordinario", transportAllowance: false }));
  assert.equal(four.solidarity, 70_036); // 7.003.620 × 1 %
  const twenty = ok(computeNetSalary({ salary: 20 * SMMLV, salaryType: "ordinario", transportAllowance: false }));
  assert.equal(twenty.solidarity, 630_326); // 35.018.100 × 1,8 % = 630.325,8
});

test("F5 salario neto: salario integral cotiza sobre el 70 %", () => {
  const r = ok(computeNetSalary({ salary: 30_000_000, salaryType: "integral", transportAllowance: true }));
  assert.equal(r.ibc, 21_000_000);
  assert.equal(r.health, 840_000);
  assert.equal(r.pension, 840_000);
  assert.equal(r.solidarity, 210_000);
  assert.equal(r.transport, 0);
  assert.equal(r.net, 28_110_000);
});

test("F5 salario neto: out-of-scope inputs are refused, never guessed", () => {
  assert.ok("error" in computeNetSalary({ salary: SMMLV - 1, salaryType: "ordinario", transportAllowance: false }));
  assert.ok("error" in computeNetSalary({ salary: 13 * SMMLV - 1, salaryType: "integral", transportAllowance: false }));
  const over = computeNetSalary({ salary: 20 * SMMLV + 1, salaryType: "ordinario", transportAllowance: false });
  assert.ok("error" in over && /20/.test(over.error), "above a 20 SMMLV base the health cap is not settled");
  assert.ok("error" in computeNetSalary({ salary: Number.POSITIVE_INFINITY, salaryType: "ordinario", transportAllowance: false }));
});

test("F5 privacidad: the calculators never send, store or log what people type", () => {
  const files = ["src/lib/labor-calculators.ts", "src/lib/labor-values.ts", "src/sections/Tools.tsx"];
  for (const file of files) {
    const source = fs.readFileSync(path.join(here, "..", file), "utf-8");
    for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "gtag(", "dataLayer", "trackEvent", "URLSearchParams", "history.replaceState", "history.pushState"]) {
      assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden}`);
    }
  }
});
