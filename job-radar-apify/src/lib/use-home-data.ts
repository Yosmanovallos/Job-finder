import { useEffect, useState } from "react";

// Live numbers for the landing page. Every figure is a real `total` from
// the same public endpoints the dashboard and /empresas already call — no
// number is ever hardcoded (AGENTS.md #5): a request that fails leaves its
// field null and the section hides that figure instead of showing a stale
// or invented one.
//
// Deliberately one hook so that, before this ships, the ~10 COUNT round
// trips below can be swapped for a single cached server endpoint without
// touching any section component (Render Starter budget, see
// docs/DASHBOARD-PERFORMANCE-RUNBOOK.md).

export interface HomeJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  source: string;
  dateText?: string;
  publishedAt?: string;
}

export interface HomeCompany {
  company: string;
  count: number;
  logoUrl: string | null;
}

export interface HomeData {
  totalJobs: number | null;
  last7Days: number | null;
  last24Hours: number | null;
  onSite: number | null;
  remote: number | null;
  totalCompanies: number | null;
  cityCounts: Record<string, number | null>;
  latestJobs: HomeJob[];
  companies: HomeCompany[];
}

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

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function jobsUrl(country: string, extra: Record<string, string> = {}, limit = 1): string {
  const params = new URLSearchParams({ country, limit: String(limit), offset: "0", ...extra });
  return `/api/jobs?${params.toString()}`;
}

interface JobsResponse {
  jobs: HomeJob[];
  total: number;
}

interface CompaniesResponse {
  companies: HomeCompany[];
  total: number;
}

export function useHomeData(country: string, cities: string[]): HomeData {
  const [data, setData] = useState<HomeData>(EMPTY);
  const citiesKey = cities.join("|");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const total = (r: JobsResponse | null) => (r && typeof r.total === "number" ? r.total : null);

    // Per-city counts are the slowest queries and sit far down the page,
    // so they wait until the browser is idle after first paint instead of
    // competing with the hero's requests on a slow phone.
    const idle: (cb: () => void) => number =
      window.requestIdleCallback?.bind(window) ?? ((cb) => window.setTimeout(cb, 1200));
    const citiesPromise = new Promise<Array<JobsResponse | null>>((resolve) => {
      idle(() => {
        if (signal.aborted) return;
        Promise.all(cities.map((city) => getJson<JobsResponse>(jobsUrl(country, { cities: city }), signal))).then(resolve);
      });
    });

    (async () => {
      const [all, week, day, onSite, remote, latest, companies] = await Promise.all([
        getJson<JobsResponse>(jobsUrl(country), signal),
        getJson<JobsResponse>(jobsUrl(country, { freshness: "7d" }), signal),
        getJson<JobsResponse>(jobsUrl(country, { freshness: "24h" }), signal),
        getJson<JobsResponse>(jobsUrl(country, { modality: "presencial" }), signal),
        getJson<JobsResponse>(jobsUrl(country, { modality: "remoto" }), signal),
        getJson<JobsResponse>(jobsUrl(country, {}, 6), signal),
        getJson<CompaniesResponse>(
          `/api/companies/search?${new URLSearchParams({ country, limit: "12", offset: "0" })}`,
          signal
        )
      ]);
      if (signal.aborted) return;

      setData((prev) => ({
        ...prev,
        totalJobs: total(all),
        last7Days: total(week),
        last24Hours: total(day),
        onSite: total(onSite),
        remote: total(remote),
        totalCompanies: companies && typeof companies.total === "number" ? companies.total : null,
        latestJobs: latest?.jobs ?? [],
        companies: companies?.companies ?? []
      }));
    })();

    citiesPromise.then((cityResults) => {
      if (signal.aborted) return;
      const cityCounts: Record<string, number | null> = {};
      cities.forEach((city, i) => {
        cityCounts[city] = total(cityResults[i]);
      });
      setData((prev) => ({ ...prev, cityCounts }));
    });

    return () => controller.abort();
    // citiesKey stands in for the array identity — callers pass a fresh
    // array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, citiesKey]);

  return data;
}

export function formatCount(value: number | null | undefined): string | null {
  return typeof value === "number" ? value.toLocaleString("es-CO") : null;
}
