import { Link, useLocation } from "react-router-dom";
import { PUBLIC_PAGES } from "../lib/agent-readiness.js";
import { usePageMeta } from "../lib/use-page-meta.js";

export default function PublicInfoPage() {
  const { pathname } = useLocation();
  const page = PUBLIC_PAGES[pathname] || PUBLIC_PAGES["/about"]!;
  usePageMeta({ title: page.title, description: page.description });

  return (
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#fafafa" }}>
      <article className="max-w-3xl mx-auto">
        <Link to="/" className="inline-block mb-6 text-sm font-mono text-primary">
          ← Volver al inicio
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold mb-6 font-heading" style={{ color: "#0e0f10" }}>
          {page.heading}
        </h1>
        <div className="space-y-4 mb-10">
          {page.introduction.map((paragraph) => (
            <p key={paragraph} className="leading-relaxed" style={{ color: "#5b5f5c" }}>
              {paragraph}
            </p>
          ))}
        </div>
        <div className="space-y-10">
          {page.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold mb-3 font-heading" style={{ color: "#0e0f10" }}>
                {section.heading}
              </h2>
              <div className="space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm md:text-base leading-relaxed" style={{ color: "#5b5f5c" }}>
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.links?.length ? (
                <ul className="mt-4 space-y-2">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      {link.href.startsWith("mailto:") ? (
                        <a className="text-sm font-medium text-primary underline" href={link.href}>{link.label}</a>
                      ) : (
                        <Link className="text-sm font-medium text-primary underline" to={link.href}>{link.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </section>
  );
}
