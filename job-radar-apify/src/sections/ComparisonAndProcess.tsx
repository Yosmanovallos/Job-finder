import { ROUTE_META } from "../lib/page-meta.js";
import { TINTS } from "../lib/brand-tints.js";
import { YouTubeLite } from "../components/YouTubeLite.js";
import { ContentCta, ContentSection, PageHero, PillLink, SectionHeading } from "../components/ContentPage.js";

// Process steps data — kept deliberately close to what the product actually
// does today: no "AI" claim for what is really a synonym dictionary
// (ai-role-agent.ts), and no mention of Notion sync, which isn't a
// user-facing step in this flow.
const processSteps = [
  {
    number: "01",
    title: "Escribe qué buscas",
    description:
      "Un cargo, una palabra clave o el área en la que quieres trabajar. Sin formularios largos.",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="14" height="12" rx="2" />
        <path d="M7 8h6M7 12h4" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Buscamos en varios portales a la vez",
    description:
      "Cruzamos sinónimos y variantes del cargo para no dejar publicaciones por fuera, en español o inglés.",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="10" cy="10" r="3" />
        <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.41 1.41M13.54 13.54l1.41 1.41M5.05 14.95l1.41-1.41M13.54 6.46l1.41-1.41" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Filtramos lo que no sirve",
    description:
      "Duplicados fusionados y enlaces caídos descartados antes de que los veas.",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h14M6 10h8M9 14h2" />
      </svg>
    ),
  },
  {
    number: "04",
    title: "Resultados listos para aplicar",
    description:
      "Ordenados por frescura, con scroll infinito y filtros por ciudad, modalidad y portal.",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="11" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="11" width="6" height="6" rx="1" />
        <rect x="11" y="11" width="6" height="6" rx="1" />
      </svg>
    ),
  },
];

export default function ComparisonAndProcess() {
  const meta = ROUTE_META["/como-funciona"]!;

  return (
    <div id="comparison-and-process" className="bg-white">
      <PageHero
        eyebrow="Cómo funciona"
        heading={meta.heading!}
        aside={
          <div className="ink-card overflow-hidden rounded-2xl md:rounded-[22px] md:shadow-[8px_8px_0_hsl(var(--primary))]">
            <YouTubeLite priority />
          </div>
        }
      >
        <p>{meta.introduction}</p>
      </PageHero>

      <ContentSection>
        <div id="como-funciona">
          <SectionHeading>Paso a paso</SectionHeading>
          <ol className="sr-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {processSteps.map((step, index) => {
              const tint = TINTS[index % TINTS.length]!;
              return (
                <li key={step.number} className="sr ink-card-sm md:ink-card ink-lift rounded-2xl md:rounded-3xl p-5 md:p-6 flex flex-col gap-3" style={{ backgroundColor: tint.bg }}>
                  <div className="flex items-center justify-between">
                    <span className="w-11 h-11 rounded-xl border-2 border-foreground bg-white grid place-items-center font-mono font-bold text-sm" style={{ color: tint.sub }}>
                      {step.number}
                    </span>
                    <span style={{ color: tint.sub }}>{step.icon}</span>
                  </div>
                  <h3 className="font-heading font-bold text-lg md:text-xl leading-snug" style={{ color: tint.fg }}>
                    {step.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-[#3d413e]">{step.description}</p>
                </li>
              );
            })}
          </ol>
          <nav aria-label="Más sobre BuscoTrabajo" className="sr mt-6 md:mt-8 flex flex-wrap gap-2.5">
            <PillLink href="/fuentes">De qué portales vienen las vacantes</PillLink>
            <PillLink href="/preguntas">Preguntas frecuentes</PillLink>
          </nav>
        </div>
      </ContentSection>

      <ContentCta />
    </div>
  );
}
