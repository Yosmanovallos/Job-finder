import { useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/use-page-meta.js";
import { ContentCta, ContentSection, PageHero } from "../components/ContentPage.js";
import RelatedGuides from "../components/RelatedGuides.js";
import {
  computeLiquidation,
  computeNetSalary,
  type ContractType,
  type SalaryType,
  type Termination
} from "../lib/labor-calculators.js";
import { LABOR_SOURCES, LABOR_VALUES, LABOR_VALUES_YEAR, formatPesos } from "../lib/labor-values.js";
import {
  LIQUIDATION_TOOL,
  NET_SALARY_TOOL,
  TOOLS_INDEX,
  TOOL_PAGES,
  TOOLS_PRIVACY_NOTE,
  type ToolPage
} from "../lib/tools-content.js";

// /herramientas and its calculators (adsense-readiness F5, ADS-060). The
// explanation is the same text the server put in the raw HTML
// (tools-content.ts). The numbers live only in this component's state:
// nothing is sent, stored, logged or put in the URL.

const inputClass =
  "mt-1.5 block w-full rounded-xl border-2 border-foreground bg-white px-3.5 py-3 text-[16px] text-foreground focus:outline-none focus:ring-4 focus:ring-primary/30";
const labelClass = "block text-[14px] md:text-[15px] font-semibold text-foreground";
const hintClass = "mt-1 text-[13px] leading-snug text-[#5b605c]";

function parsePesos(value: string): number {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : Number.NaN;
}

function formatTyped(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
      {hint ? <p className={hintClass}>{hint}</p> : null}
    </div>
  );
}

function MoneyInput({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] -translate-y-1/2 font-semibold text-[#5b605c]">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(formatTyped(event.target.value))}
        className={`${inputClass} pl-7`}
      />
    </div>
  );
}

function Choice<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className={labelClass}>{legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`cursor-pointer rounded-full border-2 border-foreground px-3.5 py-2 text-[14px] font-semibold ${value === option.value ? "bg-foreground text-white" : "bg-white text-foreground"}`}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#16704f]" />
      <div>
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        {hint ? <p className={hintClass}>{hint}</p> : null}
      </div>
    </div>
  );
}

function ResultRow({ label, amount, formula, emphasis = false, negative = false }: { label: string; amount: number; formula?: string; emphasis?: boolean; negative?: boolean }) {
  return (
    <div className={`py-3 ${emphasis ? "" : "border-b border-foreground/15"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className={emphasis ? "font-heading font-bold text-[18px] md:text-[20px]" : "text-[15px] font-semibold"}>{label}</dt>
        <dd className={`shrink-0 tabular-nums ${emphasis ? "font-heading font-bold text-[24px] md:text-[30px]" : "text-[16px] font-semibold"}`}>
          {negative && amount > 0 ? "−" : ""}
          {formatPesos(amount)}
        </dd>
      </div>
      {formula ? <p className="mt-1 font-mono text-[12px] md:text-[13px] text-[#5b605c] break-words">{formula}</p> : null}
    </div>
  );
}

function ResultPanel({ children, error }: { children?: ReactNode; error?: string }) {
  return (
    <div aria-live="polite" className="ink-card-sm rounded-2xl bg-[#eef7f2] p-5 md:p-7">
      <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#16704f]">Resultado estimado · valores {LABOR_VALUES_YEAR}</p>
      {error ? <p className="mt-3 text-[15px] leading-relaxed text-[#7a2e12]">{error}</p> : children}
      <p className="mt-4 text-[13px] leading-snug text-[#5b605c]">{TOOLS_PRIVACY_NOTE}</p>
    </div>
  );
}

function SourceNote({ keys }: { keys: Array<keyof typeof LABOR_SOURCES> }) {
  return (
    <p className="mt-3 text-[13px] leading-snug text-[#3d413e]">
      Norma aplicada:{" "}
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 ? "; " : ""}
          <a href={LABOR_SOURCES[key].url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {LABOR_SOURCES[key].label.split(",")[0]}
          </a>
        </span>
      ))}
      . Salario mínimo {formatPesos(LABOR_VALUES.minimumWage)} y auxilio de transporte {formatPesos(LABOR_VALUES.transportAllowance)}, vigentes en {LABOR_VALUES_YEAR}.
    </p>
  );
}

function LiquidationCalculator() {
  const [salary, setSalary] = useState(formatTyped(String(LABOR_VALUES.minimumWage)));
  const [salaryType, setSalaryType] = useState<SalaryType>("ordinario");
  const [transport, setTransport] = useState(true);
  const [contractType, setContractType] = useState<ContractType>("indefinido");
  const [startDate, setStartDate] = useState(`${LABOR_VALUES_YEAR}-01-01`);
  const [endDate, setEndDate] = useState(`${LABOR_VALUES_YEAR}-06-30`);
  const [agreedEndDate, setAgreedEndDate] = useState(`${LABOR_VALUES_YEAR}-12-31`);
  const [remainingObra, setRemainingObra] = useState("0");
  const [termination, setTermination] = useState<Termination>("renuncia");
  const [taken, setTaken] = useState("0");

  const result = useMemo(
    () =>
      computeLiquidation({
        salary: parsePesos(salary),
        salaryType,
        transportAllowance: transport,
        contractType,
        startDate,
        endDate,
        termination,
        vacationDaysTaken: taken.trim() === "" ? 0 : Number(taken.replace(",", ".")),
        agreedEndDate: contractType === "fijo" ? agreedEndDate : undefined,
        remainingDaysObra: contractType === "obra" ? (remainingObra.trim() === "" ? 0 : Number(remainingObra)) : undefined
      }),
    [salary, salaryType, transport, contractType, startDate, endDate, agreedEndDate, remainingObra, termination, taken]
  );

  const terminationOptions: Array<{ value: Termination; label: string }> = [
    { value: "renuncia", label: "Renuncié" },
    { value: "despido_sin_justa_causa", label: "Me despidieron sin justa causa" },
    { value: "justa_causa", label: "Despido con justa causa" },
    ...(contractType === "fijo" ? [{ value: "vencimiento" as Termination, label: "Se cumplió el plazo" }] : [])
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <form className="ink-card-sm md:ink-card rounded-2xl md:rounded-3xl bg-white p-5 md:p-8 space-y-5" onSubmit={(event) => event.preventDefault()} aria-label="Datos de la liquidación">
        <Field label="Salario mensual" hint="El último salario, sin auxilio de transporte.">
          {(id) => <MoneyInput id={id} value={salary} onChange={setSalary} />}
        </Field>
        <Choice legend="Tipo de salario" value={salaryType} onChange={setSalaryType} options={[{ value: "ordinario", label: "Ordinario" }, { value: "integral", label: "Integral" }]} />
        {salaryType === "ordinario" ? (
          <Checkbox
            checked={transport}
            onChange={setTransport}
            label="Recibo auxilio de transporte"
            hint={`Solo aplica si ganas hasta ${formatPesos(2 * LABOR_VALUES.minimumWage)}. Desmárcalo si haces teletrabajo o el empleador te da el transporte.`}
          />
        ) : null}
        <Choice
          legend="Tipo de contrato"
          value={contractType}
          onChange={(value) => {
            setContractType(value);
            if (value !== "fijo" && termination === "vencimiento") setTermination("renuncia");
          }}
          options={[
            { value: "indefinido", label: "Indefinido" },
            { value: "fijo", label: "Término fijo" },
            { value: "obra", label: "Obra o labor" }
          ]}
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Fecha de inicio">{(id) => <input id={id} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />}</Field>
          <Field label="Fecha de terminación" hint={`Debe estar en ${LABOR_VALUES_YEAR}.`}>
            {(id) => <input id={id} type="date" value={endDate} min={`${LABOR_VALUES_YEAR}-01-01`} max={`${LABOR_VALUES_YEAR}-12-31`} onChange={(event) => setEndDate(event.target.value)} className={inputClass} />}
          </Field>
        </div>
        <Choice legend="¿Cómo terminó el contrato?" value={termination} onChange={setTermination} options={terminationOptions} />
        {contractType === "fijo" && termination === "despido_sin_justa_causa" ? (
          <Field label="Fecha de terminación pactada en el contrato" hint="Se usa para contar los días que faltaban.">
            {(id) => <input id={id} type="date" value={agreedEndDate} onChange={(event) => setAgreedEndDate(event.target.value)} className={inputClass} />}
          </Field>
        ) : null}
        {contractType === "obra" && termination === "despido_sin_justa_causa" ? (
          <Field label="Días que faltaban para terminar la obra" hint="Si no lo sabes, deja 0: la ley garantiza al menos 15 días.">
            {(id) => <input id={id} type="number" min={0} inputMode="numeric" value={remainingObra} onChange={(event) => setRemainingObra(event.target.value)} className={inputClass} />}
          </Field>
        ) : null}
        <Field label="Días de vacaciones que ya disfrutaste" hint="En todo el contrato. Escribe 0 si no tomaste ninguno.">
          {(id) => <input id={id} type="number" min={0} step="0.5" inputMode="decimal" value={taken} onChange={(event) => setTaken(event.target.value)} className={inputClass} />}
        </Field>
      </form>

      <ResultPanel error={"error" in result ? result.error : undefined}>
        {"error" in result ? null : (
          <>
            <p className="mt-2 text-[14px] text-[#3d413e]">
              {result.days.total} días trabajados
              {result.prestacionesBase ? ` · base de prima y cesantías ${formatPesos(result.prestacionesBase)}${result.transportApplied ? " (con auxilio)" : ""}` : ""}
            </p>
            <dl className="mt-2">
              {result.lines.map((line) => (
                <ResultRow key={line.key} label={line.label} amount={line.amount} formula={line.formula} />
              ))}
              {result.indemnization ? (
                <ResultRow label="Indemnización por despido sin justa causa" amount={result.indemnization.amount} formula={result.indemnization.formula} />
              ) : null}
              <ResultRow label="Total estimado" amount={result.total} emphasis />
            </dl>
            {result.notes.length ? (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-snug text-[#3d413e]">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-[13px] leading-snug text-[#3d413e]">Suma también el salario de los días trabajados que aún no te hayan pagado.</p>
            <SourceNote keys={["laborCode", "severanceInterest", "proportionalVacation", "minimumWage", "transportAllowance"]} />
          </>
        )}
      </ResultPanel>
    </div>
  );
}

function NetSalaryCalculator() {
  const [salary, setSalary] = useState(formatTyped(String(LABOR_VALUES.minimumWage)));
  const [salaryType, setSalaryType] = useState<SalaryType>("ordinario");
  const [transport, setTransport] = useState(true);
  const result = useMemo(() => computeNetSalary({ salary: parsePesos(salary), salaryType, transportAllowance: transport }), [salary, salaryType, transport]);

  return (
    <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form className="ink-card-sm md:ink-card rounded-2xl md:rounded-3xl bg-white p-5 md:p-8 space-y-5" onSubmit={(event) => event.preventDefault()} aria-label="Datos del salario">
        <Field label="Salario mensual" hint="Lo que dice tu contrato, sin auxilio de transporte.">
          {(id) => <MoneyInput id={id} value={salary} onChange={setSalary} />}
        </Field>
        <Choice legend="Tipo de salario" value={salaryType} onChange={setSalaryType} options={[{ value: "ordinario", label: "Ordinario" }, { value: "integral", label: "Integral" }]} />
        {salaryType === "ordinario" ? (
          <Checkbox
            checked={transport}
            onChange={setTransport}
            label="Recibo auxilio de transporte"
            hint={`Solo aplica si ganas hasta ${formatPesos(2 * LABOR_VALUES.minimumWage)}. Desmárcalo si haces teletrabajo o el empleador te da el transporte.`}
          />
        ) : null}
      </form>
      <ResultPanel error={"error" in result ? result.error : undefined}>
        {"error" in result ? null : (
          <>
            <p className="mt-2 text-[14px] text-[#3d413e]">
              Base de cotización {formatPesos(result.ibc)} ({result.ibcInWages.toLocaleString("es-CO", { maximumFractionDigits: 2 })} salarios mínimos)
            </p>
            <dl className="mt-2">
              <ResultRow label="Salario" amount={parsePesos(salary)} />
              <ResultRow label="Salud (4 %)" amount={result.health} negative />
              <ResultRow label="Pensión (4 %)" amount={result.pension} negative />
              <ResultRow
                label={`Fondo de solidaridad pensional (${(result.solidarityRate * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %)`}
                amount={result.solidarity}
                negative
              />
              {result.transport ? <ResultRow label="Auxilio de transporte" amount={result.transport} /> : null}
              <ResultRow label="Neto antes de retención en la fuente" amount={result.net} emphasis />
            </dl>
            <p className="mt-2 text-[13px] leading-snug text-[#3d413e]">No incluye la retención en la fuente ni descuentos como libranzas o aportes voluntarios.</p>
            <SourceNote keys={["health", "pensionRate", "pension", "minimumWage", "transportAllowance"]} />
          </>
        )}
      </ResultPanel>
    </div>
  );
}

function ToolExplanation({ tool }: { tool: ToolPage }) {
  return (
    <div className="max-w-[820px] space-y-10 md:space-y-12">
      {tool.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="font-heading font-bold text-[24px] md:text-[32px] leading-tight tracking-[-0.02em] text-foreground">{section.heading}</h2>
          <div className="mt-3 space-y-3.5 text-[16px] md:text-[18px] leading-relaxed text-[#2b2f2c]">
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {section.links?.length ? (
            <ul className="mt-4 space-y-2 text-[15px] leading-snug">
              {section.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 break-words">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function ToolPageFrame({ tool, children }: { tool: ToolPage; children: ReactNode }) {
  usePageMeta({ title: tool.title, description: tool.description });
  const [lead, , disclaimer] = tool.introduction;
  const other = TOOL_PAGES.find((item) => item.slug !== tool.slug);
  return (
    <div className="bg-white">
      <PageHero eyebrow="Herramienta" heading={tool.heading}>
        <p>{lead}</p>
        <p className="text-[14px] md:text-[15px]">{disclaimer}</p>
      </PageHero>
      <section className="max-w-[1240px] w-full mx-auto px-4 md:px-6 pb-4 md:pb-8">
        <nav aria-label="Ruta" className="mb-5 text-sm">
          <Link to="/herramientas" className="font-semibold underline underline-offset-4">
            ← Todas las herramientas
          </Link>
        </nav>
        {children}
      </section>
      <ContentSection>
        <ToolExplanation tool={tool} />
        <RelatedGuides className="ink-card-sm mt-12 max-w-[820px] rounded-2xl bg-white p-5 md:p-7" />
        {other ? (
          <p className="mt-10 max-w-[820px] text-[16px] leading-relaxed">
            También puedes usar la{" "}
            <Link to={other.path} className="font-semibold underline underline-offset-4">
              {other.name.toLowerCase()}
            </Link>
            .
          </p>
        ) : null}
      </ContentSection>
      <ContentCta />
    </div>
  );
}

export function LiquidationToolPage() {
  return (
    <ToolPageFrame tool={LIQUIDATION_TOOL}>
      <LiquidationCalculator />
    </ToolPageFrame>
  );
}

export function NetSalaryToolPage() {
  return (
    <ToolPageFrame tool={NET_SALARY_TOOL}>
      <NetSalaryCalculator />
    </ToolPageFrame>
  );
}

export function ToolsIndex() {
  usePageMeta({ title: TOOLS_INDEX.title, description: TOOLS_INDEX.description });
  return (
    <div className="bg-white">
      <PageHero eyebrow="Herramientas" heading={TOOLS_INDEX.heading}>
        {TOOLS_INDEX.introduction.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </PageHero>
      <ContentSection>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {TOOL_PAGES.map((tool, index) => (
            <li key={tool.slug} className="ink-card-sm md:ink-card rounded-2xl md:rounded-3xl p-5 md:p-8" style={{ backgroundColor: index === 0 ? "#fdf1d3" : "#e3f1fb" }}>
              <h2 className="font-heading font-bold text-[22px] md:text-[28px] leading-tight">
                <Link to={tool.path} className="text-foreground no-underline hover:underline">
                  {tool.name}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] md:text-[16px] leading-relaxed text-[#3d413e]">{tool.summary}</p>
              <Link
                to={tool.path}
                className="mt-5 inline-flex h-[48px] items-center rounded-xl border-2 border-foreground bg-white px-5 font-bold text-foreground no-underline"
              >
                Abrir la calculadora →
              </Link>
            </li>
          ))}
        </ul>
      </ContentSection>
      <ContentCta />
    </div>
  );
}
