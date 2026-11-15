import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePageMeta } from "../lib/use-page-meta.js";
import {
  GUIDES_INDEX_DESCRIPTION,
  GUIDES_INDEX_HEADING,
  GUIDES_INDEX_INTRO,
  GUIDES_INDEX_TITLE,
  formatSpanishDate,
  isGuidePayload,
  isGuideSummaryList,
  type GuidePayload,
  type GuideSummary
} from "../lib/guides.js";
import { ContentCta, ContentSection, PageHero } from "../components/ContentPage.js";

declare global {
  interface Window {
    __SSR_GUIDE__?: unknown;
    __SSR_GUIDES__?: unknown;
  }
}

// /guias and /guias/:slug (adsense-readiness F3). Same pattern as
// EmpleosIndex: the server already sent the full article in the raw HTML
// plus a payload (window.__SSR_GUIDE__ / __SSR_GUIDES__); after a
// client-side navigation the same data comes from /api/guias. The article
// HTML is produced by src/lib/guides.ts from the repo's Markdown, with
// every text run escaped — never from user or scraped input.

const proseClass =
  "max-w-[760px] text-[16px] md:text-[18px] leading-relaxed text-[#2b2f2c] " +
  "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:font-heading [&_h2]:font-bold [&_h2]:text-[24px] md:[&_h2]:text-[30px] [&_h2]:leading-tight [&_h2]:tracking-[-0.02em] [&_h2]:text-foreground " +
  "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:font-bold [&_h3]:text-[19px] md:[&_h3]:text-[22px] [&_h3]:text-foreground " +
  "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 " +
  "[&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:decoration-foreground/30 [&_a]:underline-offset-4 " +
  "[&_sup]:ml-0.5 [&_sup_a]:no-underline [&_sup_a]:text-[#0a4f96] [&_section]:mt-12 [&_section]:border-t [&_section]:border-foreground/15 [&_section]:pt-2 [&_section_li]:text-[15px]";

function useGuidesData<T>(read: () => T | null, url: string, accept: (value: unknown) => value is T, key: string): { data: T | null; missing: boolean } {
  const [state, setState] = useState<{ data: T | null; missing: boolean }>(() => ({ data: read(), missing: false }));
  useEffect(() => {
    const ssr = read();
    if (ssr) {
      setState({ data: ssr, missing: false });
      return;
    }
    let cancelled = false;
    setState({ data: null, missing: false });
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setState(accept(data) ? { data, missing: false } : { data: null, missing: true });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, missing: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function NotAvailable() {
  return (
    <div className="bg-white">
      <PageHero eyebrow="Guías" heading="Guía no disponible">
        <p>
          Esta guía no existe o ya no está publicada. <Link to="/dashboard">Ver vacantes de hoy</Link>.
        </p>
      </PageHero>
    </div>
  );
}

export function GuidesIndex() {
  const { data, missing } = useGuidesData<GuideSummary[]>(
    () => {
      const ssr = window.__SSR_GUIDES__;
      return isGuideSummaryList(ssr) ? ssr : null;
    },
    "/api/guias",
    isGuideSummaryList,
    "index"
  );
  usePageMeta({ title: GUIDES_INDEX_TITLE, description: GUIDES_INDEX_DESCRIPTION });
  if (missing) return <NotAvailable />;
  return (
    <div className="bg-white">
      <PageHero eyebrow="Guías" heading={GUIDES_INDEX_HEADING}>
        <p>{GUIDES_INDEX_INTRO}</p>
      </PageHero>
      <ContentSection>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {(data ?? []).map((guide) => (
            <li key={guide.slug} className="ink-card-sm rounded-2xl p-5 md:p-7 bg-white">
              <Link to={guide.path} className="font-heading font-bold text-xl md:text-2xl leading-tight text-foreground no-underline hover:underline">
                {guide.title}
              </Link>
              <p className="mt-2 text-[15px] leading-relaxed text-[#3d413e]">{guide.description}</p>
              <p className="mt-3 font-mono text-xs text-[#5b605c]">
                Actualizada el <time dateTime={guide.dateModified}>{formatSpanishDate(guide.dateModified)}</time>
              </p>
            </li>
          ))}
        </ul>
      </ContentSection>
      <ContentCta />
    </div>
  );
}

export function GuidePage() {
  const { pathname } = useLocation();
  const slug = pathname.split("/")[2] ?? "";
  const { data, missing } = useGuidesData<GuidePayload>(
    () => {
      const ssr = window.__SSR_GUIDE__;
      return isGuidePayload(ssr) && ssr.slug === slug ? ssr : null;
    },
    `/api/guias/${encodeURIComponent(slug)}`,
    isGuidePayload,
    slug
  );
  usePageMeta({ title: data ? `${data.title} | BuscoTrabajo` : "Guías | BuscoTrabajo", description: data?.description ?? GUIDES_INDEX_DESCRIPTION });
  if (missing) return <NotAvailable />;
  if (!data) return <div className="min-h-[60vh] bg-white" aria-busy="true" />;
  return (
    <div className="bg-white">
      <PageHero eyebrow="Guía" heading={data.title}>
        <p className="text-[14px] md:text-[15px] font-mono">
          Por {data.author} · Publicada el <time dateTime={data.datePublished}>{formatSpanishDate(data.datePublished)}</time> · Actualizada el{" "}
          <time dateTime={data.dateModified}>{formatSpanishDate(data.dateModified)}</time> · Revisada por {data.reviewedBy} el {formatSpanishDate(data.reviewDate)}
        </p>
      </PageHero>
      <ContentSection>
        <nav aria-label="Ruta" className="mb-6 text-sm">
          <Link to="/guias" className="font-semibold underline underline-offset-4">
            ← Todas las guías
          </Link>
        </nav>
        <article className={proseClass} dangerouslySetInnerHTML={{ __html: data.html }} />
      </ContentSection>
      <ContentCta />
    </div>
  );
}
