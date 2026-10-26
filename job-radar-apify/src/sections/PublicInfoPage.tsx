import { useLocation } from "react-router-dom";
import { PUBLIC_PAGES } from "../lib/agent-readiness.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { TINTS } from "../lib/brand-tints.js";
import { ContentCta, ContentSection, InkPanel, PageHero, PillLink } from "../components/ContentPage.js";

// /docs, /about, /contact and /privacy. The copy is the agent-readiness
// contract (PUBLIC_PAGES, also served as HTML/Markdown by server.ts) and is
// rendered verbatim — only the presentation lives here.
const EYEBROW: Record<string, string> = {
  "/docs": "Documentación",
  "/about": "Sobre BuscoTrabajo",
  "/contact": "Contacto",
  "/privacy": "Privacidad"
};

export default function PublicInfoPage() {
  const { pathname } = useLocation();
  const page = PUBLIC_PAGES[pathname] || PUBLIC_PAGES["/about"]!;
  usePageMeta({ title: page.title, description: page.description });
  const lastIsAlone = page.sections.length % 2 === 1;

  return (
    <div className="bg-white">
      <PageHero eyebrow={EYEBROW[pathname] ?? "BuscoTrabajo"} heading={page.heading}>
        {page.introduction.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </PageHero>
      <ContentSection>
        <div className="sr-stagger grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {page.sections.map((section, index) => {
            const tint = TINTS[index % TINTS.length]!;
            const wide = lastIsAlone && index === page.sections.length - 1;
            return (
              <InkPanel key={section.heading} tint={tint.bg} className={wide ? "md:col-span-2" : ""}>
                <p className="font-mono text-xs font-bold" style={{ color: tint.sub }}>
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-1 font-heading font-bold text-xl md:text-[28px] leading-tight tracking-[-0.02em]" style={{ color: tint.fg }}>
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="text-[15px] md:text-base leading-relaxed text-[#3d413e]">
                      {paragraph}
                    </p>
                  ))}
                </div>
                {section.links?.length ? (
                  <ul className="mt-5 flex flex-wrap gap-2.5">
                    {section.links.map((link) => (
                      <li key={link.href}>
                        <PillLink href={link.href}>{link.label}</PillLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </InkPanel>
            );
          })}
        </div>
      </ContentSection>
      <ContentCta />
    </div>
  );
}
