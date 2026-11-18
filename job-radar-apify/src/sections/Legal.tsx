import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/use-page-meta.js";
import { ROUTE_META } from "../lib/page-meta.js";
import { TINTS } from "../lib/brand-tints.js";
import { ContentSection, InkPanel, PageHero } from "../components/ContentPage.js";
import { LEGAL_CONTENT, type LegalPageType } from "../lib/legal-content.js";

export type { LegalPageType };

const content = LEGAL_CONTENT;

const LEGAL_LINKS: Array<{ type: LegalPageType; label: string }> = [
  { type: "terminos", label: "Términos de uso" },
  { type: "privacidad", label: "Privacidad" },
  { type: "uso-aceptable", label: "Uso aceptable" },
  { type: "cookies", label: "Cookies" }
];

// Presentation only: the legal text above is the user's to change.
export default function Legal({ type }: { type: LegalPageType }) {
  const page = content[type];

  usePageMeta(ROUTE_META[`/legal/${type}`]!);

  return (
    <div className="bg-white">
      <PageHero eyebrow="Legal" heading={page.title}>
        <p>Última actualización: {page.updated}. Preguntas: buscotrabajocolombia123@gmail.com</p>
      </PageHero>
      <ContentSection>
        <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
          <nav aria-label="Documentos legales" className="md:sticky md:top-24 w-full md:w-[240px] shrink-0">
            <ul className="flex md:flex-col flex-wrap gap-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.type}>
                  <Link
                    to={`/legal/${link.type}`}
                    aria-current={link.type === type ? "page" : undefined}
                    className={`ink-card-sm inline-flex md:flex w-full rounded-xl px-4 py-2.5 text-sm font-semibold no-underline ${
                      link.type === type ? "bg-primary text-white" : "bg-white text-foreground ink-lift"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="sr-stagger flex-1 min-w-0 flex flex-col gap-4 md:gap-6">
            {page.sections.map((section, index) => {
              const tint = TINTS[index % TINTS.length]!;
              return (
                <InkPanel key={section.title} tint={tint.bg}>
                  <p className="font-mono text-xs font-bold" style={{ color: tint.sub }}>
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h2 className="mt-1 font-heading font-bold text-xl md:text-[26px] leading-tight tracking-[-0.02em]" style={{ color: tint.fg }}>
                    {section.title}
                  </h2>
                  <div className="mt-3 space-y-3">
                    {section.paragraphs.map((p, i) => (
                      <p key={i} className="text-[15px] md:text-base leading-relaxed text-[#3d413e]">
                        {p}
                      </p>
                    ))}
                  </div>
                </InkPanel>
              );
            })}
          </div>
        </div>
      </ContentSection>
    </div>
  );
}
