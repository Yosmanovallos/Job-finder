// Copy, metadata and structured data for /herramientas (adsense-readiness
// F5, ADS-060). The server injects this text into the raw HTML and the
// React pages render the same strings, so a crawler and a visitor read the
// same explanation. Amounts in the worked examples come from the
// calculators themselves, never typed by hand.

import type { PublicContent } from "./agent-readiness.js";
import { computeLiquidation, computeNetSalary, type LiquidationResult, type NetSalaryResult } from "./labor-calculators.js";
import { LABOR_SOURCES, LABOR_VALUES, LABOR_VALUES_YEAR, formatPesos, type LaborSourceKey } from "./labor-values.js";

export const TOOLS_BASE_PATH = "/herramientas";
export const SEO_TITLE_MAX = 60;

export type ToolSlug = "calculadora-de-liquidacion" | "calculadora-salario-neto";

export interface ToolPage {
  slug: ToolSlug;
  path: string;
  /** <title>, 60 characters or fewer. */
  title: string;
  description: string;
  heading: string;
  /** Card title on /herramientas and in menus. */
  name: string;
  summary: string;
  introduction: string[];
  sections: PublicContent["sections"];
  sources: LaborSourceKey[];
  /** /guias tags for the «Guías relacionadas» block. */
  guideTags: string[];
}

const SMMLV = LABOR_VALUES.minimumWage;
const AUX = LABOR_VALUES.transportAllowance;
const P = formatPesos;

export const TOOLS_PRIVACY_NOTE =
  "El cálculo ocurre en tu navegador: lo que escribes no se envía a BuscoTrabajo ni a nadie más y no se guarda. Al cerrar o recargar la página, los datos desaparecen.";

export const TOOLS_DISCLAIMER =
  "Es una estimación con las reglas generales de la ley, no una asesoría legal. Si tu caso tiene pagos variables, acuerdos especiales o una convención colectiva, el valor puede ser distinto. Ante una diferencia, pide a tu empleador el cálculo por escrito o consulta al Ministerio del Trabajo.";

const VALUES_SECTION: PublicContent["sections"][number] = {
  heading: `Valores de ${LABOR_VALUES_YEAR} que usa la calculadora`,
  paragraphs: [
    `Salario mínimo mensual: ${P(SMMLV)}. Lo fijó el Decreto 1469 de 2025. El Consejo de Estado suspendió provisionalmente ese decreto en febrero de 2026 y el Gobierno expidió el Decreto 159 de 2026 con la misma cifra de forma transitoria; según la nota de vigencia del normograma oficial, la suspensión ya se levantó. En los dos casos el valor es ${P(SMMLV)}.`,
    `Auxilio de transporte: ${P(AUX)} al mes, para quienes ganan hasta dos salarios mínimos (${P(2 * SMMLV)}), según el Decreto 1470 de 2025. Quien hace teletrabajo recibe un auxilio de conectividad en lugar del de transporte (Ley 2466 de 2025), y quien recibe el transporte del empleador tampoco lo cobra: en esos casos desmarca la casilla del auxilio.`,
    `Los valores solo sirven para ${LABOR_VALUES_YEAR}. Si tu fecha está en otro año, la calculadora no la acepta, en lugar de aplicarte cifras que no corresponden. Revisamos cada valor en la fuente oficial al cambiar el año.`
  ]
};

function sourcesSection(keys: LaborSourceKey[]): PublicContent["sections"][number] {
  return {
    heading: "Fuentes oficiales",
    paragraphs: [
      "Cada valor y cada regla se leyó en la norma publicada por una entidad del Estado. La fecha de consulta va junto a cada enlace.",
      "Estas normas cambian con los años: si ves un valor que ya no está vigente, escríbenos desde Contacto y lo revisamos."
    ],
    links: keys.map((key) => ({ label: `${LABOR_SOURCES[key].label} (consultado el ${LABOR_SOURCES[key].consulted})`, href: LABOR_SOURCES[key].url }))
  };
}

// --- Worked examples (computed, not typed) -------------------------------

export const LIQUIDATION_EXAMPLE_INPUT = {
  salary: SMMLV,
  salaryType: "ordinario",
  transportAllowance: true,
  contractType: "fijo",
  startDate: `${LABOR_VALUES_YEAR}-01-01`,
  endDate: `${LABOR_VALUES_YEAR}-06-30`,
  termination: "renuncia",
  vacationDaysTaken: 0
} as const;

function liquidationExample(): LiquidationResult {
  const result = computeLiquidation({ ...LIQUIDATION_EXAMPLE_INPUT });
  if ("error" in result) throw new Error(`liquidation example failed: ${result.error}`);
  return result;
}

function netExample(salary: number, transportAllowance: boolean): NetSalaryResult {
  const result = computeNetSalary({ salary, salaryType: "ordinario", transportAllowance });
  if ("error" in result) throw new Error(`net salary example failed: ${result.error}`);
  return result;
}

function liquidationExampleParagraphs(): string[] {
  const r = liquidationExample();
  const line = (key: string) => r.lines.find((item) => item.key === key)!;
  return [
    `Una persona gana el salario mínimo (${P(SMMLV)}) con auxilio de transporte, trabajó del 1 de enero al 30 de junio de ${LABOR_VALUES_YEAR} con contrato a término fijo, renunció y no tomó vacaciones. Son ${r.days.total} días, y la base de prima y cesantías es ${P(r.prestacionesBase)} (salario más auxilio).`,
    `Prima: ${line("prima").formula} = ${P(line("prima").amount)}. Cesantías: ${line("cesantias").formula} = ${P(line("cesantias").amount)}. Intereses: ${line("intereses").formula} = ${P(line("intereses").amount)}. Vacaciones: ${r.days.total} días × 15 ÷ 360 = ${r.vacationDaysPending.toLocaleString("es-CO")} días pendientes; ${line("vacaciones").formula} = ${P(line("vacaciones").amount)}.`,
    `Total estimado: ${P(r.total)}, más el salario de los días trabajados que aún no te hayan pagado. Como renunció, no hay indemnización.`
  ];
}

function netExampleParagraphs(): string[] {
  const min = netExample(SMMLV, true);
  const mid = netExample(8_000_000, false);
  return [
    `Con el salario mínimo y auxilio de transporte: salud ${P(min.health)} (4 % de ${P(min.ibc)}), pensión ${P(min.pension)}, sin fondo de solidaridad. Neto: ${P(SMMLV)} − ${P(min.health + min.pension)} + ${P(min.transport)} de auxilio = ${P(min.net)}.`,
    `Con un salario de ${P(8_000_000)} (unos ${mid.ibcInWages.toLocaleString("es-CO", { maximumFractionDigits: 2 })} salarios mínimos): salud ${P(mid.health)}, pensión ${P(mid.pension)} y fondo de solidaridad ${P(mid.solidarity)} (1 %, porque la base supera 4 salarios mínimos). No hay auxilio de transporte. Neto antes de retención en la fuente: ${P(mid.net)}.`
  ];
}

// --- Pages ----------------------------------------------------------------

export const LIQUIDATION_TOOL: ToolPage = {
  slug: "calculadora-de-liquidacion",
  path: `${TOOLS_BASE_PATH}/calculadora-de-liquidacion`,
  title: `Calculadora de liquidación laboral ${LABOR_VALUES_YEAR} | BuscoTrabajo`,
  description: `Calcula gratis tu liquidación en Colombia: prima, cesantías, intereses, vacaciones e indemnización por despido sin justa causa, con valores de ${LABOR_VALUES_YEAR}.`,
  heading: `Calculadora de liquidación de contrato ${LABOR_VALUES_YEAR}`,
  name: "Calculadora de liquidación",
  summary: "Prima, cesantías, intereses, vacaciones no disfrutadas e indemnización por despido sin justa causa, según el tipo de contrato.",
  introduction: [
    "Escribe tu salario, las fechas del contrato y cómo terminó, y la calculadora estima cada concepto de tu liquidación con la fórmula que fija la ley colombiana. Debajo de cada valor ves la operación con tus números, para que puedas compararla con la liquidación que te entregue tu empleador.",
    TOOLS_PRIVACY_NOTE,
    TOOLS_DISCLAIMER
  ],
  sections: [
    VALUES_SECTION,
    {
      heading: "Cómo se calcula cada concepto",
      paragraphs: [
        "Prima de servicios: (salario + auxilio de transporte) × días trabajados en el semestre ÷ 360. El Código Sustantivo del Trabajo (art. 306) fija 30 días de salario por año, pagados en dos mitades: a más tardar el 30 de junio y en los primeros veinte días de diciembre. La calculadora cuenta los días desde el inicio del semestre en que termina el contrato, o desde tu fecha de ingreso si empezaste después, porque supone que la prima del semestre anterior ya te la pagaron.",
        "Cesantías: (salario + auxilio de transporte) × días trabajados en el año ÷ 360. Es un mes de salario por cada año de servicio y la proporción por fracción (CST art. 249). La calculadora cuenta desde el 1 de enero del año en que termina el contrato, o desde tu ingreso, porque supone que las cesantías de los años anteriores ya se consignaron en tu fondo de cesantías.",
        "Intereses sobre cesantías: cesantías × días × 12 % ÷ 360. El empleador paga intereses del 12 % anual sobre el saldo de cesantías y, si el contrato termina antes del 31 de diciembre, en proporción al tiempo transcurrido del año (Decreto 1072 de 2015, art. 2.2.1.3.4). La calculadora usa las cesantías ya redondeadas que ves en pantalla, para que puedas repetir la cuenta.",
        "Vacaciones no disfrutadas: por cada año trabajado se causan 15 días hábiles de vacaciones (CST art. 186), y al terminar el contrato las que no disfrutaste se pagan en dinero en proporción al tiempo trabajado, cualquiera que sea (Ley 995 de 2005, art. 1). Los días causados son días trabajados × 15 ÷ 360; a esos se restan los que ya tomaste. Cada día pendiente se valora como un treintavo del último salario (CST art. 189), sin auxilio de transporte.",
        "Auxilio de transporte: se suma a la base de la prima, las cesantías y sus intereses, porque la ley lo incorpora al salario solo para liquidar prestaciones sociales (Ley 1 de 1963, art. 7, según la Corte Suprema de Justicia en la Sentencia 2994 de 1989; la Ley 2466 de 2025 repite esa base para las cesantías). La misma sentencia dice que esa regla es limitativa, por eso no se suma a las vacaciones ni a la indemnización.",
        "Días: cada mes cuenta como 30 días y el año como 360, contando el primer y el último día. Es el criterio que recogen el Ministerio del Trabajo y las altas cortes según Función Pública (Concepto 328041 de 2021); la ley no fija un método único, así que tu empleador puede llegar a una cifra que difiera en algunos pesos."
      ]
    },
    {
      heading: "Indemnización por despido sin justa causa",
      paragraphs: [
        "Si el empleador termina el contrato sin una justa causa comprobada, además de la liquidación debe una indemnización (CST art. 64). Su valor depende del tipo de contrato, y se calcula con el salario sin auxilio de transporte:",
        "Término fijo: los salarios del tiempo que faltaba para cumplir el plazo pactado. Escribe la fecha de terminación que dice tu contrato y la calculadora cuenta los días que faltaban.",
        "Obra o labor: los salarios del tiempo que faltaba para terminar la obra, nunca menos de 15 días de salario. Como solo tú y el empleador saben cuánto faltaba, la calculadora te pide ese número de días.",
        "Término indefinido, si ganas menos de 10 salarios mínimos: 30 días de salario si llevabas hasta un año, y 20 días más por cada año siguiente, en proporción por la fracción de año.",
        "Término indefinido, si ganas 10 salarios mínimos o más: 20 días de salario si llevabas hasta un año, y 15 días más por cada año siguiente, también en proporción.",
        "Si renuncias, si te despiden con justa causa o si el contrato a término fijo termina porque se cumplió el plazo, no hay indemnización, pero sí liquidación. La Ley 2466 de 2025 (art. 5) dice que en un contrato indefinido debes avisar tu renuncia con 30 días, salvo que renuncies por una causa imputable al empleador; en ese caso puedes reclamar la indemnización.",
        "Quienes ya tenían 10 años o más con el mismo empleador cuando entró en vigencia la Ley 789 de 2002 conservan la tabla de la Ley 50 de 1990 (parágrafo transitorio del art. 64). Por eso, si tu contrato empezó antes de 1993, la calculadora no estima la indemnización."
      ]
    },
    {
      heading: "Si tienes salario integral",
      paragraphs: [
        `El salario integral no puede ser menor a 10 salarios mínimos más un factor prestacional de al menos 30 %, es decir ${P(LABOR_VALUES.integralMinWages * SMMLV)} en ${LABOR_VALUES_YEAR} (CST art. 132). Ese factor ya compensa la prima, las cesantías y sus intereses, así que la liquidación solo trae las vacaciones no disfrutadas y, si hubo despido sin justa causa, la indemnización.`
      ]
    },
    {
      heading: "Ejemplo resuelto",
      paragraphs: liquidationExampleParagraphs()
    },
    {
      heading: "Lo que la calculadora supone y no cubre",
      paragraphs: [
        "Supone un salario fijo y jornada completa. Si recibes comisiones, horas extra o recargos frecuentes, la base de la prima y las cesantías se calcula de otra forma y el resultado puede cambiar.",
        "No suma el salario de los días trabajados que aún no te han pagado, ni descuentos como préstamos o anticipos. Agrégalos tú al revisar la liquidación.",
        "No calcula la indemnización por mora del art. 65 del CST, que aplica cuando el empleador no paga a tiempo los salarios y prestaciones al terminar el contrato.",
        "La reforma laboral (Ley 2466 de 2025) no cambió los artículos del Código que usa esta calculadora (64, 132, 186, 189, 249 y 306). Sí confirmó que en los contratos a término fijo y por obra o labor se pagan vacaciones y prestaciones en proporción al tiempo trabajado, cualquiera que sea (art. 6)."
      ]
    },
    sourcesSection(["minimumWage", "minimumWageTransitory", "transportAllowance", "laborCode", "severanceInterest", "proportionalVacation", "laborReform", "transportInPrestaciones", "days360"])
  ],
  sources: ["minimumWage", "minimumWageTransitory", "transportAllowance", "laborCode", "severanceInterest", "proportionalVacation", "laborReform", "transportInPrestaciones", "days360"],
  guideTags: ["prestaciones", "contratos"]
};

export const NET_SALARY_TOOL: ToolPage = {
  slug: "calculadora-salario-neto",
  path: `${TOOLS_BASE_PATH}/calculadora-salario-neto`,
  title: `Calculadora de salario neto ${LABOR_VALUES_YEAR} en Colombia | BuscoTrabajo`,
  description: `Calcula cuánto recibes al mes después de salud, pensión y fondo de solidaridad pensional, con el salario mínimo y el auxilio de transporte de ${LABOR_VALUES_YEAR}.`,
  heading: `Calculadora de salario neto ${LABOR_VALUES_YEAR}`,
  name: "Calculadora de salario neto",
  summary: "Cuánto te queda al mes después de los aportes a salud, pensión y fondo de solidaridad pensional, con el auxilio de transporte si te corresponde.",
  introduction: [
    "Escribe tu salario mensual y la calculadora resta los aportes que la ley pone a cargo del trabajador: salud, pensión y, si ganas 4 salarios mínimos o más, el fondo de solidaridad pensional. Si ganas hasta dos salarios mínimos, suma el auxilio de transporte.",
    TOOLS_PRIVACY_NOTE,
    TOOLS_DISCLAIMER
  ],
  sections: [
    VALUES_SECTION,
    {
      heading: "Cómo se calcula",
      paragraphs: [
        `Base de cotización: tu salario mensual, nunca menos de un salario mínimo. Si tienes salario integral, la base es el 70 % del salario (Ley 797 de 2003, art. 5). La salud usa la misma base que la pensión (Ley 100 de 1993, art. 204, parágrafo 1).`,
        "Salud: 4 % de la base. La cotización total es 12,5 %: 8,5 % la paga el empleador y 4 % el trabajador (Ley 1122 de 2007, art. 10).",
        "Pensión: 4 % de la base. La cotización total es 16 % desde 2008 (Decreto 4982 de 2007) y el trabajador paga el 25 % de ella (Ley 797 de 2003, art. 7).",
        "Auxilio de transporte: si ganas hasta dos salarios mínimos y no haces teletrabajo, se suma al neto. No hace parte de la base de cotización: no es salario, y la ley solo lo incorpora para liquidar prestaciones sociales (Corte Suprema de Justicia, Sentencia 2994 de 1989)."
      ]
    },
    {
      heading: "Fondo de solidaridad pensional",
      paragraphs: [
        "Quien tiene una base de cotización de 4 salarios mínimos o más aporta 1 % adicional al fondo de solidaridad pensional. Desde 16 salarios mínimos se suma otro aporte, para la subcuenta de subsistencia (Ley 797 de 2003, arts. 7 y 8):",
        "De 16 a 17 salarios mínimos: 0,2 % adicional (1,2 % en total). De 17 a 18: 0,4 % (1,4 %). De 18 a 19: 0,6 % (1,6 %). De 19 a 20: 0,8 % (1,8 %). Más de 20: 1 % (2 %).",
        "Cómo leemos los bordes: cada tramo incluye su límite inferior, así que con exactamente 4 salarios mínimos ya aportas el 1 %, y con exactamente 16 pasas al 1,2 %. Con exactamente 20 sigues en el 1,8 %, porque la ley reserva el 2 % para las bases «superiores a 20»."
      ]
    },
    {
      heading: "Hasta qué salario sirve",
      paragraphs: [
        `La calculadora llega hasta una base de cotización de 20 salarios mínimos (${P(LABOR_VALUES.netSalaryMaxBaseWages * SMMLV)}). La pensión tiene un tope de 25 salarios mínimos (Ley 797 de 2003, art. 5), pero la Ley 100 permite limitar la base de salud a 20 (art. 204, parágrafo 3). Como no pudimos confirmar qué tope aplica hoy a la salud por encima de 20, la calculadora no da una cifra en ese rango en lugar de adivinarla.`
      ]
    },
    {
      heading: "Por qué no calculamos la retención en la fuente",
      paragraphs: [
        "La retención en la fuente sobre salarios depende de la depuración de cada persona: dependientes, intereses de vivienda, medicina prepagada, aportes voluntarios y rentas exentas con topes en UVT (Estatuto Tributario, art. 383). Con solo el salario no se puede calcular bien, y no hemos verificado el procedimiento completo ni el valor de la UVT de este año en la fuente oficial.",
        "Por eso el neto que ves es antes de retención. Si tu salario es alto, tu empleador puede descontarte además una retención; pídele el cálculo o revisa el certificado de ingresos y retenciones."
      ]
    },
    {
      heading: "Ejemplos resueltos",
      paragraphs: netExampleParagraphs()
    },
    {
      heading: "Lo que la calculadora supone y no cubre",
      paragraphs: [
        "Supone un contrato de trabajo con salario fijo y jornada completa. Si recibes horas extra, recargos o comisiones, esos pagos también cotizan y el descuento crece.",
        "No incluye otros descuentos que puede traer tu desprendible, como préstamos de libranza, aportes voluntarios a pensión, cuotas sindicales o embargos, porque dependen de lo que tú hayas autorizado o de una orden judicial.",
        "No sirve para trabajadores independientes ni contratos de prestación de servicios, que cotizan con otras reglas.",
        `Usa las reglas vigentes de la Ley 100 de 1993 y la Ley 797 de 2003 para ${LABOR_VALUES_YEAR}. Si una reforma cambia los porcentajes, actualizaremos la calculadora después de leer la norma oficial.`
      ]
    },
    sourcesSection(["minimumWage", "minimumWageTransitory", "transportAllowance", "health", "healthBase", "pensionRate", "pension", "transportInPrestaciones"])
  ],
  sources: ["minimumWage", "minimumWageTransitory", "transportAllowance", "health", "healthBase", "pensionRate", "pension", "transportInPrestaciones"],
  guideTags: ["prestaciones", "contratos"]
};

export const TOOL_PAGES: ToolPage[] = [LIQUIDATION_TOOL, NET_SALARY_TOOL];

export const TOOLS_INDEX = {
  path: TOOLS_BASE_PATH,
  title: "Herramientas laborales gratis para Colombia | BuscoTrabajo",
  description: `Calculadoras gratuitas de liquidación de contrato y salario neto en Colombia, con valores de ${LABOR_VALUES_YEAR} y la norma oficial citada. Sin registro y sin guardar tus datos.`,
  heading: "Herramientas para tu vida laboral",
  introduction: [
    `Calculadoras para revisar tu liquidación y tu salario neto con los valores de ${LABOR_VALUES_YEAR}. Cada una explica la fórmula, cita la norma oficial y muestra la cuenta con tus propios números.`,
    TOOLS_PRIVACY_NOTE
  ]
};

export function toolBySlug(slug: string): ToolPage | undefined {
  return TOOL_PAGES.find((tool) => tool.slug === slug);
}

export function toolPublicContent(tool: ToolPage): PublicContent {
  return { pathname: tool.path, title: tool.title, description: tool.description, heading: tool.heading, introduction: tool.introduction, sections: tool.sections };
}

export function toolsIndexPublicContent(): PublicContent {
  return {
    pathname: TOOLS_INDEX.path,
    title: TOOLS_INDEX.title,
    description: TOOLS_INDEX.description,
    heading: TOOLS_INDEX.heading,
    introduction: TOOLS_INDEX.introduction,
    sections: TOOL_PAGES.map((tool) => ({ heading: tool.name, paragraphs: [tool.summary], links: [{ label: `Abrir la ${tool.name.toLowerCase()}`, href: tool.path }] }))
  };
}

// --- Structured data --------------------------------------------------------

function publisher(origin: string) {
  return { "@type": "Organization", name: "BuscoTrabajo", url: origin };
}

/** WebApplication JSON-LD. No ratings or reviews: we have none to report. */
export function toolJsonLd(tool: ToolPage, origin: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.name,
    url: `${origin}${tool.path}`,
    description: tool.description,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Cualquiera (se usa en el navegador)",
    browserRequirements: "Requiere JavaScript",
    inLanguage: "es-CO",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "COP" },
    publisher: publisher(origin),
    citation: tool.sources.map((key) => LABOR_SOURCES[key].url)
  };
}

export function toolsBreadcrumbJsonLd(tool: ToolPage | null, origin: string): Record<string, unknown> {
  const items = [
    { "@type": "ListItem", position: 1, name: "Inicio", item: `${origin}/` },
    { "@type": "ListItem", position: 2, name: "Herramientas", item: `${origin}${TOOLS_BASE_PATH}` }
  ];
  if (tool) items.push({ "@type": "ListItem", position: 3, name: tool.name, item: `${origin}${tool.path}` });
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
}

export function toolsItemListJsonLd(origin: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: TOOLS_INDEX.heading,
    itemListElement: TOOL_PAGES.map((tool, index) => ({ "@type": "ListItem", position: index + 1, name: tool.name, url: `${origin}${tool.path}` }))
  };
}

/** Link to a calculator shown at the end of a guide (render code, not the signed prose). */
export const GUIDE_TOOL_LINKS: Record<string, ToolSlug[]> = {
  "liquidacion-del-contrato": ["calculadora-de-liquidacion", "calculadora-salario-neto"],
  "prestaciones-sociales": ["calculadora-de-liquidacion", "calculadora-salario-neto"]
};

export function toolLinksForGuide(slug: string): Array<{ name: string; path: string; summary: string }> {
  return (GUIDE_TOOL_LINKS[slug] ?? []).map((toolSlug) => toolBySlug(toolSlug)!).map((tool) => ({ name: tool.name, path: tool.path, summary: tool.summary }));
}
