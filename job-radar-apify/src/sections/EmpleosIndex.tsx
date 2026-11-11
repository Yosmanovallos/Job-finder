import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePageMeta } from "../lib/use-page-meta.js";
import {
  EMPLEOS_INDEX_HEADINGS,
  buildEmpleosIndexIntro,
  buildEmpleosIndexMeta,
  buildEmpleosIndexSections,
  isEmpleosIndexPayload,
  type EmpleosIndexCountry,
  type EmpleosIndexLink,
  type EmpleosIndexPayload
} from "../lib/empleos-index.js";

declare global {
  interface Window {
    __SSR_EMPLEOS__?: unknown;
  }
}

// /empleos and /ve/empleos (seo-empleos-coverage, ADR 0014). The server
// embeds the page's data (window.__SSR_EMPLEOS__) next to the raw HTML it
// already rendered; after a client-side navigation there is no payload, so
// the same data comes from /api/empleos-index. Until it arrives the page
// shows the links that need no count (cities, roles), never a made-up total.
function readSsrPayload(country: EmpleosIndexCountry): EmpleosIndexPayload | null {
  const ssr = window.__SSR_EMPLEOS__;
  return isEmpleosIndexPayload(ssr) && ssr.country === country ? ssr : null;
}

function LinkGrid({ heading, links }: { heading: string; links: EmpleosIndexLink[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-label={heading} className="mt-10 md:mt-12">
      <h2 className="font-heading font-bold text-xl md:text-2xl text-foreground">{heading}</h2>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link to={link.href} className="text-[15px] font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function EmpleosIndex() {
  const location = useLocation();
  const country: EmpleosIndexCountry = location.pathname.startsWith("/ve") ? "VE" : "CO";
  const [payload, setPayload] = useState<EmpleosIndexPayload | null>(() => readSsrPayload(country));

  useEffect(() => {
    const ssr = readSsrPayload(country);
    if (ssr) {
      delete window.__SSR_EMPLEOS__;
      setPayload(ssr);
      return;
    }
    let cancelled = false;
    setPayload(null);
    fetch(`/api/empleos-index?country=${country}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && isEmpleosIndexPayload(data) && data.country === country) setPayload(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [country]);

  const total = payload ? payload.total : null;
  const meta = buildEmpleosIndexMeta(country, total);
  // Without data yet: only the links that never depend on a count.
  const sections = payload ? payload.sections : buildEmpleosIndexSections(country, () => undefined);
  const jobs = payload ? payload.jobs : [];
  usePageMeta({ title: meta.title, description: meta.description });

  return (
    <main className="bg-white min-h-screen">
      <div className="bg-gradient-to-b from-green-soft to-white">
        <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-6 pb-10 md:pt-12 md:pb-14">
      <h1 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-foreground">{meta.heading}</h1>
      <p className="mt-4 max-w-3xl text-base md:text-lg leading-relaxed text-foreground/80">
        {buildEmpleosIndexIntro(country, total)}
      </p>

      {jobs.length > 0 && (
        <section aria-label={EMPLEOS_INDEX_HEADINGS.jobs} className="mt-10 md:mt-12">
          <h2 className="font-heading font-bold text-xl md:text-2xl text-foreground">{EMPLEOS_INDEX_HEADINGS.jobs}</h2>
          <ul className="ink-card mt-4 divide-y divide-foreground/10 rounded-3xl bg-white">
            {jobs.map((job) => (
              <li key={job.path} className="px-5 py-3.5">
                <Link to={job.path} className="font-semibold text-foreground hover:underline underline-offset-4">
                  {job.title}
                </Link>
                <span className="block text-sm text-foreground/70">
                  {job.company} · {job.location}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LinkGrid heading={EMPLEOS_INDEX_HEADINGS.cities} links={sections.cities} />
      <LinkGrid heading={EMPLEOS_INDEX_HEADINGS.intents} links={sections.intents} />
      <LinkGrid heading={EMPLEOS_INDEX_HEADINGS.roles} links={sections.roles} />
      <LinkGrid heading={EMPLEOS_INDEX_HEADINGS.more} links={sections.more} />
        </div>
      </div>
    </main>
  );
}
