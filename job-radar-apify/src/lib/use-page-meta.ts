import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_URL = "https://buscotrabajo.co";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export interface PageMetaInput {
  title: string;
  description: string;
}

// The app has no SSR, so plain DOM updates in an effect are enough — every
// routed page calls this, so there's no stale state to restore on unmount.
export function usePageMeta({ title, description }: PageMetaInput) {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertCanonical(`${SITE_URL}${pathname}`);
  }, [title, description, pathname]);
}

export function PageMeta(props: PageMetaInput) {
  usePageMeta(props);
  return null;
}
