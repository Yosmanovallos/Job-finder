import { BrowsersIcon as Browsers } from "@phosphor-icons/react/dist/csr/Browsers";
import { CopyIcon as Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { LinkBreakIcon as LinkBreak } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { getCountryConfig, SOURCES_BY_COUNTRY } from "../countries/index.js";
import { TINTS } from "../lib/brand-tints.js";
import { SourceLogo } from "../components/SourceLogo.js";
import { ContentCta, ContentSection, InkPanel, PageHero, PillLink, SectionHeading } from "../components/ContentPage.js";
import {
  SOURCES_PAGE_DISCLOSURES,
  SOURCES_PAGE_HEADING,
  SOURCES_PAGE_INTRO,
  SOURCES_PAGE_LINKS
} from "../lib/sources-page.js";

const problems = [
  {
    icon: Browsers,
    title: "Diez pestañas abiertas",
    description:
      "Cada portal tiene su propio buscador, sus propios filtros y una forma distinta de mostrar la fecha de publicación."
  },
  {
    icon: Copy,
    title: "La misma vacante cuatro veces",
    description:
      "Una misma oportunidad puede aparecer en varias fuentes. Sin una vista unificada, es fácil revisarla o postularse más de una vez."
  },
  {
    icon: LinkBreak,
    title: "Ofertas que ya no existen",
    description:
      "Publicaciones cerradas hace semanas que siguen apareciendo como si estuvieran abiertas. Descubres el error al hacer clic."
  }
];

export interface SourcesAndProblemProps {
  // Defaults to "CO" so /fuentes (rendered outside the country-aware
  // Landing route) keeps today's exact source list.
  country?: string;
  // Kept for the /fuentes route's call site; the page is always standalone
  // now (the homepage has its own portal marquee).
  standalone?: boolean;
}

// /fuentes. Heading, intro, disclosures and links come from sources-page.ts,
// the same strings server.ts puts in the raw HTML.
export default function SourcesAndProblem({ country = "CO" }: SourcesAndProblemProps) {
  const sources = SOURCES_BY_COUNTRY[country] || SOURCES_BY_COUNTRY.CO;
  const countryName = getCountryConfig(country).name;

  return (
    <div id="fuentes" className="bg-white" data-sources-page>
      <PageHero eyebrow="Transparencia de fuentes" heading={SOURCES_PAGE_HEADING}>
        <p>{SOURCES_PAGE_INTRO}</p>
      </PageHero>

      <ContentSection>
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4 md:gap-6">
          <InkPanel tint="#fdf1d3">
            <h2 className="font-heading font-bold text-xl md:text-[28px] leading-tight tracking-[-0.02em] text-[#2a1d06]">
              Fuentes disponibles en {countryName}
            </h2>
            <ul className="mt-5 flex flex-wrap gap-2 md:gap-2.5">
              {sources.map((source) => (
                <li
                  key={source}
                  className="inline-flex items-center gap-2 rounded-full border-2 border-foreground bg-white py-1 pl-1 pr-3 md:py-1.5 md:pl-1.5 md:pr-4 font-heading font-bold text-[13px] md:text-[15px] whitespace-nowrap"
                >
                  <SourceLogo source={source} lazy />
                  {source}
                </li>
              ))}
            </ul>
          </InkPanel>
          <InkPanel tint="#e6f4ec">
            <h2 className="font-heading font-bold text-xl md:text-[28px] leading-tight tracking-[-0.02em] text-green-deep">
              Qué significa que rastreamos una fuente
            </h2>
            <ul className="mt-5 flex flex-col gap-4">
              {SOURCES_PAGE_DISCLOSURES.map((disclosure) => (
                <li key={disclosure} className="flex gap-3 text-[15px] md:text-base leading-relaxed text-[#3d413e]">
                  <span aria-hidden="true" className="shrink-0 w-7 h-7 rounded-full border-2 border-foreground bg-primary text-white grid place-items-center text-sm font-bold">✓</span>
                  <span>{disclosure}</span>
                </li>
              ))}
            </ul>
          </InkPanel>
        </div>
        <nav aria-label="Explorar BuscoTrabajo" className="sr mt-6 md:mt-8 flex flex-wrap gap-2.5">
          {SOURCES_PAGE_LINKS.map((link) => (
            <PillLink key={link.href} href={link.href}>
              {link.label}
            </PillLink>
          ))}
        </nav>
      </ContentSection>

      <ContentSection>
        <SectionHeading>Buscar empleo hoy es un trabajo de tiempo completo</SectionHeading>
        <div className="sr-stagger grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {problems.map(({ icon: Icon, title, description }, index) => {
            const tint = TINTS[(index + 1) % TINTS.length]!;
            return (
              <div key={title} className="sr ink-card-sm md:ink-card ink-lift rounded-2xl md:rounded-3xl p-5 md:p-7 flex flex-col gap-3" style={{ backgroundColor: tint.bg }}>
                <span className="w-12 h-12 rounded-xl border-2 border-foreground bg-white grid place-items-center">
                  <Icon weight="duotone" size={24} style={{ color: tint.sub }} />
                </span>
                <h3 className="font-heading font-bold text-lg md:text-xl leading-snug" style={{ color: tint.fg }}>
                  {title}
                </h3>
                <p className="text-[15px] leading-relaxed text-[#3d413e]">{description}</p>
              </div>
            );
          })}
        </div>
      </ContentSection>

      <ContentCta />
    </div>
  );
}
