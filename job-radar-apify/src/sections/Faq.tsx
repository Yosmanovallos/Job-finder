import { useLocation } from "react-router-dom";
import { buildFaqItems } from "../lib/faq-content.js";
import { getEffectiveCountry } from "../lib/country-context.js";
import { ROUTE_META } from "../lib/page-meta.js";
import { TINTS } from "../lib/brand-tints.js";
import { ContentCta, ContentSection, PageHero, PillLink } from "../components/ContentPage.js";

export interface FaqProps {
  // Optional: callers that already know their country (e.g.
  // ProductFeaturesPricingFaq, itself given `country` by Landing) pass it
  // explicitly. Standalone use (the /preguntas route) has no such caller,
  // so it falls back to getEffectiveCountry — same pattern Header.tsx uses
  // for pages with no /ve prefix of their own.
  country?: string;
}

export default function Faq({ country }: FaqProps) {
  const location = useLocation();
  const effectiveCountry = country || getEffectiveCountry(location.pathname);
  const faqItems = buildFaqItems(effectiveCountry);
  const meta = ROUTE_META["/preguntas"]!;

  // <details>, not a JS accordion: every answer is in the DOM (crawlers and
  // in-page search see them all) and opening one needs no React state.
  return (
    <div id="preguntas" className="bg-white">
      <PageHero eyebrow="Preguntas frecuentes" heading={meta.heading!}>
        <p>{meta.introduction}</p>
      </PageHero>
      <ContentSection>
        <div className="sr-stagger max-w-[880px] flex flex-col gap-3 md:gap-4">
          {faqItems.map((item, index) => {
            const tint = TINTS[index % TINTS.length]!;
            return (
              <details key={item.id} open={index === 0} className="sr group ink-card-sm rounded-2xl bg-white open:bg-[var(--faq-tint)]" style={{ ["--faq-tint" as string]: tint.bg }}>
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-5 md:px-6 py-4 md:py-5 min-h-[56px] [&::-webkit-details-marker]:hidden">
                  <h2 className="font-heading font-bold text-[17px] md:text-xl leading-snug">{item.question}</h2>
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-full border-2 border-foreground bg-white grid place-items-center font-bold transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="px-5 md:px-6 pb-5 md:pb-6 -mt-1 text-[15px] md:text-base leading-relaxed text-[#3d413e]">{item.answer}</p>
              </details>
            );
          })}
        </div>
        <p className="sr mt-6 md:mt-8 flex flex-wrap items-center gap-3 text-[15px] text-[#3d413e]">
          ¿No encontraste tu respuesta o algo falló?
          <PillLink href="/opiniones">Opiniones y ayuda</PillLink>
        </p>
      </ContentSection>
      <ContentCta />
    </div>
  );
}
