// Full text of the client-rendered content pages in their raw HTML
// (openspec/changes/adsense-readiness, rule TX-1). Before this, /legal/*,
// /preguntas and /como-funciona answered with only a heading and one line;
// the rest arrived after JavaScript ran, so a reviewer or crawler reading
// the server HTML saw 6-40 words. The words come from the same modules the
// React pages render, so raw HTML and hydrated DOM say the same thing.

import type { RouteMeta } from "./page-meta.js";
import type { PublicContent } from "./agent-readiness.js";
import { legalServerContent, type LegalPageType } from "./legal-content.js";
import { buildFaqItems } from "./faq-content.js";
import { PROCESS_STEPS } from "./process-steps.js";

type ServerRouteMeta = RouteMeta & { sections?: PublicContent["sections"] };

const LEGAL_PREFIX = "/legal/";
const LEGAL_TYPES: ReadonlySet<string> = new Set<LegalPageType>(["terminos", "privacidad", "uso-aceptable", "cookies"]);

export function serverSectionsFor(pathname: string): { introduction?: string; sections: PublicContent["sections"] } | null {
  if (pathname.startsWith(LEGAL_PREFIX)) {
    const type = pathname.slice(LEGAL_PREFIX.length);
    if (!LEGAL_TYPES.has(type)) return null;
    return legalServerContent(type as LegalPageType);
  }
  if (pathname === "/preguntas") {
    // /preguntas has no /ve variant; the React page falls back to Colombia
    // the same way (getEffectiveCountry on a path without /ve).
    return {
      sections: buildFaqItems("CO").map((item) => ({ heading: item.question, paragraphs: [item.answer] }))
    };
  }
  if (pathname === "/como-funciona") {
    return {
      sections: [
        {
          heading: "Paso a paso",
          paragraphs: PROCESS_STEPS.map((step) => `${step.number}. ${step.title}: ${step.description}`)
        }
      ]
    };
  }
  return null;
}

export function withServerText(pathname: string, meta: RouteMeta): ServerRouteMeta {
  const extra = serverSectionsFor(pathname);
  if (!extra) return meta;
  return {
    ...meta,
    ...(extra.introduction && !meta.introduction ? { introduction: extra.introduction } : {}),
    sections: extra.sections
  };
}
