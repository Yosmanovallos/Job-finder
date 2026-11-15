import { Link, useLocation } from "react-router-dom";
import { readSsrGuideLinks } from "../lib/guides.js";

declare global {
  interface Window {
    __SSR_GUIDE_LINKS__?: unknown;
  }
}

// «Guías relacionadas» on hubs and job pages (adsense-readiness F3): the
// same 2–3 links the server put in the raw HTML (window.__SSR_GUIDE_LINKS__,
// tied to this exact path). After a client-side navigation there is no
// payload and nothing renders. Empty while /guias is switched off.
export default function RelatedGuides({ className = "" }: { className?: string }) {
  const { pathname } = useLocation();
  const links = readSsrGuideLinks(window.__SSR_GUIDE_LINKS__, pathname);
  if (links.length === 0) return null;
  return (
    <nav data-related-guides aria-label="Guías relacionadas" className={className}>
      <h2 className="font-heading font-bold text-xl md:text-2xl text-foreground">Guías relacionadas</h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.slug}>
            <Link to={link.path} className="text-[15px] font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
