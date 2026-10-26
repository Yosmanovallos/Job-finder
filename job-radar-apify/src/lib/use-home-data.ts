import { useEffect, useState } from "react";
import type { HomeData } from "./home-stats.js";

export type { HomeCompany, HomeData, HomeJob } from "./home-stats.js";

// Live numbers for the landing page, from ONE cached server endpoint
// (GET /api/home-stats, see server.ts). Every figure is a real count with
// the dashboard's own filters — no number is ever hardcoded (AGENTS.md #5):
// a part that failed arrives null/empty and the section hides that figure,
// and a failed request leaves everything hidden instead of showing a stale
// or invented number.

const EMPTY: HomeData = {
  totalJobs: null,
  last7Days: null,
  last24Hours: null,
  onSite: null,
  remote: null,
  totalCompanies: null,
  cityCounts: {},
  latestJobs: [],
  companies: []
};

export function useHomeData(country: string): HomeData {
  const [data, setData] = useState<HomeData>(EMPTY);

  useEffect(() => {
    const controller = new AbortController();
    setData(EMPTY);
    fetch(`/api/home-stats?${new URLSearchParams({ country })}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<HomeData>) : null))
      .then((body) => {
        if (body && !controller.signal.aborted) setData(body);
      })
      .catch(() => {
        // Network error or abort: figures stay hidden.
      });
    return () => controller.abort();
  }, [country]);

  return data;
}

export function formatCount(value: number | null | undefined): string | null {
  return typeof value === "number" ? value.toLocaleString("es-CO") : null;
}
