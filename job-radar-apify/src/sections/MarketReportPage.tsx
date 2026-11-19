import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { PublicContent } from "../lib/agent-readiness.js";
import { MARKET_REPORT_INDEX_PATH } from "../lib/market-report.js";
import PublicInfoPage from "./PublicInfoPage.js";

// /informes and /informes/empleo-colombia-AAAA-MM (adsense-readiness F4).
// The content is computed on the server from the frozen editions and
// arrives as window.__SSR_REPORT__ (first load) or /api/informes/... (in-app
// navigation), so this page renders the same words the raw HTML carries.
interface ReportPayload {
  pathname: string;
  content: PublicContent;
  noindex?: boolean;
}

declare global {
  interface Window {
    __SSR_REPORT__?: ReportPayload;
  }
}

type State = { pathname: string; content: PublicContent | null; status: "loading" | "found" | "not-found" };

function fromSsr(pathname: string): State | null {
  const payload = window.__SSR_REPORT__;
  if (!payload || payload.pathname !== pathname || !payload.content) return null;
  delete window.__SSR_REPORT__;
  return { pathname, content: payload.content, status: "found" };
}

export default function MarketReportPage() {
  const { pathname } = useLocation();
  const [state, setState] = useState<State>(() => fromSsr(pathname) ?? { pathname, content: null, status: "loading" });

  useEffect(() => {
    if (state.pathname === pathname && state.status !== "loading") return;
    const controller = new AbortController();
    setState({ pathname, content: null, status: "loading" });
    fetch(`/api${pathname}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ content: PublicContent }>) : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        setState(body?.content ? { pathname, content: body.content, status: "found" } : { pathname, content: null, status: "not-found" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ pathname, content: null, status: "not-found" });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (state.content && state.pathname === pathname) {
    return <PublicInfoPage page={state.content} eyebrow="Informes del mercado laboral" />;
  }
  if (state.status === "not-found") {
    return (
      <div className="bg-white max-w-[1240px] mx-auto px-4 md:px-6 py-16">
        <h1 className="font-heading font-bold text-[32px]">Informe no encontrado</h1>
        <p className="mt-3">
          <Link to={MARKET_REPORT_INDEX_PATH} className="font-bold text-primary underline underline-offset-4">
            Ver todos los informes
          </Link>
        </p>
      </div>
    );
  }
  return <div className="bg-white min-h-[60vh]" aria-busy="true" />;
}
