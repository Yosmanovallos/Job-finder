import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCountryConfig, SOURCES_BY_COUNTRY } from "../countries/index.js";
import { getHomeContent } from "../lib/agent-readiness.js";
import { buildCategoryPath, buildJobPath } from "../lib/job-seo.js";
import { companyLinkProps } from "../lib/company-page-client.js";
import { useAuth } from "../auth/auth-provider.js";
import { jobDateLabel } from "../lib/job-date-label.js";
import { formatCount, useHomeData, type HomeCompany, type HomeData } from "../lib/use-home-data.js";
import { getHomeCities } from "../lib/home-stats.js";
import { CompanyAvatar } from "../components/CompanyAvatar.js";
import { getSourceColor } from "../lib/source-colors.js";
import { SourceLogo } from "../components/SourceLogo.js";
import { YouTubeLite } from "../components/YouTubeLite.js";

// Homepage approved on the design canvas (R3, 2026-10-25): one DOM for both
// layouts — sections only change arrangement at `md`, and the phone order
// differs from desktop through CSS `order` (phone: stats + "lo más nuevo"
// right after the portals; desktop has no "lo más nuevo" strip). The <h1>
// is getHomeContent().heading verbatim because server.ts injects that same
// string into the raw HTML before hydration.
//
// Simplified 2026-10-27 after mobile feedback: every section shares one
// container, one vertical rhythm and one header (H2 + optional link); phone
// sections stack vertically instead of mixing swipe rails, lists and grids;
// colors are flat white / black / green / gold, no gradients or extra tints;
// and all text uses the five sizes below. The phone H1 keeps production's
// exact 34px / -0.045em: at 32px the metric-matched fallback font wrapped it
// in 3 lines and the web font in 4, a 34px layout shift on load.
const HOME_HEADING_FONT = "font-['Space_Grotesk','Space_Grotesk_Home_Fallback',sans-serif]";
const T = {
  // H1 and H2 use their own fallback face (index.css), width-matched to
  // Space Grotesk so headings keep their line breaks when the font swaps.
  h1: `${HOME_HEADING_FONT} font-bold text-[34px] md:text-[56px] leading-[1.04] md:leading-[1.06] tracking-[-0.045em] md:tracking-[-0.04em]`,
  h2: `${HOME_HEADING_FONT} font-bold text-2xl md:text-[40px] leading-[1.1] tracking-[-0.03em]`,
  h3: "font-heading font-bold text-[17px] md:text-xl leading-snug",
  body: "text-base leading-relaxed",
  small: "text-[13px]"
};
// Big figures (stats, featured counts) reuse the H1 size instead of adding
// a sixth one.
const FIGURE = "font-heading font-bold text-[34px] md:text-[56px] leading-none tracking-[-0.04em]";
const CONTAINER = "max-w-[1240px] w-full mx-auto px-4 md:px-6";
const SECTION_Y = "py-10 md:py-16";

// Role pages that exist in sitemap-categories.xml (DEFAULT_ROLES_200) —
// labels slugify to exactly those URLs through buildCategoryPath.
const POPULAR_ROLES = [
  "Asesor comercial",
  "Auxiliar administrativo",
  "Auxiliar de enfermería",
  "Ejecutivo de ventas",
  "Contador público",
  "Desarrollador full stack",
  "Analista de logística",
  "Cuidadora de adultos mayores",
  "Diseñador gráfico",
  "Ingeniero industrial",
  "Community manager",
  "Ingeniero civil"
];

function useCountUp(target: number | null, durationMs = 1600): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

// Read synchronously on first render (this page is client-rendered), so
// the desktop-only art never mounts — and never downloads — on a phone.
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function SearchIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

// Same header in every section: H2 on the left, optional "ver todo" link on
// the right.
function SectionHeader({ title, link, className = "" }: { title: React.ReactNode; link?: { to: string; label: string }; className?: string }) {
  return (
    <div className={`sr flex items-end justify-between gap-4 mb-5 md:mb-8 ${className}`}>
      <h2 className={`${T.h2} min-w-0 max-w-[760px]`}>{title}</h2>
      {link ? (
        <Link to={link.to} className={`${T.small} md:text-base shrink-0 whitespace-nowrap font-bold text-primary`}>
          {link.label} →
        </Link>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Hero({ country, data }: { country: string; data: HomeData }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const countryConfig = getCountryConfig(country);
  const homeContent = getHomeContent(country === "VE" ? "VE" : "CO");
  const [headingLead, headingTail] = homeContent.heading.split(": ");
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";
  const total = formatCount(data.totalJobs);
  const isDesktop = useMinWidth(768);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `${dashboardPath}?${new URLSearchParams({ search: q })}` : dashboardPath);
  };

  return (
    <section className="order-1 bg-white">
      <div className={`${CONTAINER} pt-8 pb-10 md:pt-12 md:pb-16 flex flex-wrap items-center gap-10`}>
        <div className="flex-[1_1_460px] min-w-0">
          <p className={`${T.small} ink-card-sm inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] pl-2 pr-3 py-1 font-semibold mb-5 shadow-none`}>
            <span aria-hidden="true" className="home-live-dot w-2.5 h-2.5 rounded-full bg-primary" />
            {total ? `${total} vacantes activas en ${countryConfig.name}` : `Vacantes activas en ${countryConfig.name}`}
          </p>
          {/* Phone H1 reserves 4 lines: the web font wraps it in 4 from 324
              to 430px, and before the width-matched fallback, Arial fit 3
              from 406px up (Pixel 412, iPhone Pro Max 430), so the font swap
              pushed everything below 35px down (Lighthouse CLS 0.032). Kept
              as a backstop for the few widths where the two still differ;
              browsers without the lh unit ignore it. */}
          <h1 className={`${T.h1} min-h-[4lh] md:min-h-0`}>
            {headingLead}: <span className="text-primary">{headingTail}</span>
          </h1>
          {/* Desktop only: on a phone the hero keeps one message (the H1)
              and one action (the search). */}
          <p className={`${T.body} hidden md:block mt-5 max-w-[540px] text-[#3d413e]`}>
            Una sola búsqueda en {SOURCES_BY_COUNTRY[country]?.slice(1, 4).join(", ") ?? "los principales portales"} y más. Sin repetidas, sin vencidas, gratis.
          </p>

          <form
            role="search"
            onSubmit={submit}
            className="mt-6 md:mt-8 max-w-[620px] md:ink-card md:rounded-[22px] md:bg-white md:p-3.5 flex flex-col gap-2.5 md:shadow-[6px_6px_0_hsl(var(--foreground))]"
          >
            <label htmlFor="home-search" className={`${T.small} hidden md:block font-mono font-semibold tracking-wider text-muted-foreground`}>
              ¿QUÉ TRABAJO BUSCAS?
            </label>
            <div className="relative min-w-0">
              <SearchIcon className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground md:hidden" />
              <input
                id="home-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="¿Qué trabajo buscas?"
                aria-label="¿Qué trabajo buscas?"
                className="w-full h-[54px] md:h-[60px] rounded-xl md:rounded-[14px] border-2 border-foreground bg-white md:bg-[#fbfaf6] pl-11 md:pl-[18px] pr-4 text-base focus:outline-none focus:ring-4 focus:ring-gold-1/60"
              />
            </div>
            <button
              type="submit"
              className="whitespace-nowrap h-[54px] md:h-[60px] rounded-xl md:rounded-[14px] border-2 border-foreground bg-gold-2 text-foreground font-heading font-bold text-base flex items-center justify-center gap-2.5 shadow-[3px_3px_0_hsl(var(--foreground))] md:shadow-none"
            >
              <SearchIcon className="w-5 h-5 hidden md:block" />
              {total ? <span className="hidden md:inline">Buscar en {total} vacantes</span> : null}
              <span className={total ? "md:hidden" : ""}>Buscar vacantes</span>
            </button>
          </form>
        </div>

        {/* Product art — desktop only: on a 390px screen the dashboard
            screenshot was unreadable and pushed the content a full screen
            down (canvas review, 2026-10-25). Not just CSS-hidden: images
            inside display:none still download, so phones would pay for
            two screenshots they never see. */}
        {isDesktop ? (
        <div className="flex-[1.1_1_520px] min-w-0 relative py-10 pl-10" aria-hidden="true">
          <div className="relative overflow-hidden rounded-[32px] border-2 border-foreground bg-primary py-11 pl-11">
            <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-gold-2 opacity-35" />
            <div className="relative overflow-hidden rounded-l-[14px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
              {/* LCP element on desktop: high priority, and server.ts
                  preloads it for "/" and "/ve" so it doesn't wait on JS. */}
              <img
                src="/home/dash-desktop.webp"
                srcSet="/home/dash-desktop-960.webp 960w, /home/dash-desktop.webp 1600w"
                sizes="680px"
                alt=""
                width={1600}
                height={1000}
                fetchPriority="high"
                className="block w-[130%] max-w-none h-auto"
              />
            </div>
          </div>
          <div className="home-float absolute left-0 bottom-0 w-[170px] overflow-hidden rounded-[26px] border-[6px] border-foreground bg-foreground shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)] -rotate-3">
            <img src="/home/dash-mobile.webp" alt="" width={780} height={1688} decoding="async" className="block w-full h-auto" />
          </div>
          {formatCount(data.last24Hours) ? (
            <div className={`${T.small} ink-card-sm absolute right-2.5 top-0 rounded-[14px] bg-white px-4 py-3 rotate-2`}>
              <strong>{formatCount(data.last24Hours)}</strong> nuevas en 24 h
            </div>
          ) : null}
          {formatCount(data.remote) ? (
            <div className={`${T.small} ink-card-sm absolute right-8 bottom-2.5 rounded-[14px] bg-[#fdf1d3] px-4 py-3 -rotate-1`}>
              ✓ {formatCount(data.remote)} remotas
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    </section>
  );
}

function Portals({ country }: { country: string }) {
  const sources = SOURCES_BY_COUNTRY[country] ?? SOURCES_BY_COUNTRY.CO;
  // Each half of the track repeats the list until it is wider than any
  // screen (one set is ~1,150 px on desktop), so the right edge never runs
  // empty before the loop restarts. Spacing is a right margin on every chip,
  // not flex gap, so translateX(-50%) lands exactly on the second half.
  // Duration scales with the repeats to keep the same speed in px/s.
  const REPEATS = 3;
  const half = Array.from({ length: REPEATS }, () => sources).flat();
  const chip = (source: string, key: string, hidden: boolean) => (
    <span
      key={key}
      aria-hidden={hidden || undefined}
      className={`${T.small} md:text-base mr-2 md:mr-3.5 inline-flex items-center gap-2 rounded-full border-2 border-foreground bg-white py-1 pl-1 pr-3 md:py-1.5 md:pl-1.5 md:pr-4 font-heading font-bold whitespace-nowrap`}
    >
      <SourceLogo source={source} />
      {source}
    </span>
  );
  return (
    <section aria-label="Portales que reúne BuscoTrabajo" className="order-2 overflow-hidden border-y-2 border-foreground bg-[#fdf1d3] py-3 md:py-[18px]">
      <div className="marquee-track flex w-max" style={{ animationDuration: `${22 * REPEATS}s` }}>
        {half.map((s, i) => chip(s, `a-${i}`, i >= sources.length))}
        {half.map((s, i) => chip(s, `b-${i}`, true))}
      </div>
    </section>
  );
}

function StatValue({ value, className }: { value: number | null; className?: string }) {
  const animated = useCountUp(value);
  return <p className={className}>{formatCount(animated) ?? "—"}</p>;
}

function Stats({ country, data }: { country: string; data: HomeData }) {
  const countryName = getCountryConfig(country).name;
  const items: Array<{ value: number | null; label: string; color: string; phone: boolean }> = [
    { value: data.totalJobs, label: "ofertas de empleo activas", color: "text-gold-1", phone: true },
    { value: data.last7Days, label: "publicadas en los últimos 7 días", color: "text-white", phone: true },
    { value: data.onSite, label: "presenciales", color: "text-white", phone: false },
    { value: data.remote, label: "remotas", color: "text-white", phone: true },
    { value: data.totalCompanies, label: "empresas en nuestro portal", color: "text-white", phone: true }
  ];
  return (
    <section className="sr-host order-3 bg-foreground text-white">
      <div className={`${CONTAINER} ${SECTION_Y}`}>
        <h2 className={`sr ${T.h2} mb-6 md:mb-10`}>El empleo en {countryName} hoy</h2>
        <div className="sr-stagger grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-6 md:gap-0">
          {items.map((item) => (
            <div key={item.label} className={`sr ${item.phone ? "" : "hidden md:block"} border-t border-white/20 pt-4 md:py-6 md:pr-6`}>
              <StatValue value={item.value} className={`${FIGURE} ${item.color}`} />
              <p className={`${T.small} md:text-base mt-2 text-[#b5c2ba]`}>{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LatestJobs({ country, data }: { country: string; data: HomeData }) {
  if (data.latestJobs.length === 0) return null;
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";
  return (
    <section className={`sr-host order-4 md:hidden ${CONTAINER} ${SECTION_Y}`}>
      <SectionHeader title="Lo más nuevo ahora" link={{ to: dashboardPath, label: "Ver todo" }} />
      <div className="flex flex-col gap-3">
        {data.latestJobs.slice(0, 3).map((job) => {
          const color = getSourceColor(job.source);
          return (
            <Link key={job.jobId} to={buildJobPath(job)} className="sr ink-card-sm rounded-2xl bg-white p-4 flex gap-3 text-foreground no-underline">
              <CompanyAvatar name={job.company} logoUrl={null} className="w-10 h-10 text-base shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className={`${T.h3} line-clamp-2`}>{job.title}</h3>
                <p className={`${T.small} mt-0.5 text-muted-foreground truncate`}>{job.company} · {job.location}</p>
                <div className={`${T.small} mt-2 flex flex-wrap gap-1.5 font-mono`}>
                  <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: color.bg, color: color.text }}>{job.source}</span>
                  <span className="rounded-full px-2 py-0.5 bg-green-soft text-primary">{jobDateLabel(job)}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function CompanyTile({ company, country, accessToken, className = "" }: { company: HomeCompany; country: string; accessToken: string | null; className?: string }) {
  return (
    <Link
      {...companyLinkProps({ companyName: company.company, logoUrl: company.logoUrl, count: company.count }, country, accessToken)}
      className={`sr ink-card-sm ink-lift rounded-2xl bg-white p-3.5 md:p-4 items-center gap-3 text-foreground no-underline ${className || "flex"}`}
    >
      <CompanyAvatar name={company.company} logoUrl={company.logoUrl} className="w-10 h-10 md:w-11 md:h-11 text-lg shrink-0" />
      <span className="min-w-0">
        <strong className={`${T.h3} block truncate`}>{company.company}</strong>
        <span className={`${T.small} text-muted-foreground`}>{company.count.toLocaleString("es-CO")} vacantes</span>
      </span>
    </Link>
  );
}

function Companies({ country, data }: { country: string; data: HomeData }) {
  const { accessToken } = useAuth();
  if (data.companies.length === 0) return null;
  const [featured, ...rest] = data.companies;
  const directoryPath = country === "VE" ? "/ve/empresas" : "/empresas";
  const countryName = getCountryConfig(country).name;
  const totalCompanies = formatCount(data.totalCompanies);
  return (
    <section className={`sr-host order-5 md:order-4 ${CONTAINER} ${SECTION_Y}`}>
      <SectionHeader
        title={<>Empresas que están contratando<span className="hidden md:inline"> en {countryName}</span></>}
        link={{ to: directoryPath, label: totalCompanies ? `Ver las ${totalCompanies}` : "Ver todas" }}
      />

      <div className="flex flex-col md:flex-row md:flex-wrap gap-3 md:gap-5">
        <div className="md:flex-[1_1_380px] md:min-w-0 flex flex-col gap-5">
          <Link
            {...companyLinkProps({ companyName: featured.company, logoUrl: featured.logoUrl, count: featured.count }, country, accessToken)}
            className="sr ink-card ink-lift block rounded-2xl md:rounded-3xl bg-[#fdf1d3] p-5 md:p-7 text-foreground no-underline"
          >
            <div className="flex items-center gap-3 md:gap-4">
              <CompanyAvatar name={featured.company} logoUrl={featured.logoUrl} className="w-11 h-11 md:w-16 md:h-16 text-2xl border-2 border-foreground shrink-0" />
              <div className="min-w-0">
                <p className={`${T.small} font-mono font-semibold text-gold-3`}>LA QUE MÁS CONTRATA HOY</p>
                <h3 className={`${T.h3} truncate`}>{featured.company}</h3>
              </div>
            </div>
            <p className="mt-4 md:mt-5 flex items-baseline gap-2">
              <span className={FIGURE}>{featured.count.toLocaleString("es-CO")}</span>
              <span className={`${T.body} font-semibold`}>vacantes activas</span>
            </p>
            <p className={`${T.small} md:text-base mt-3 font-bold text-primary`}>Ver vacantes de {featured.company} →</p>
          </Link>
          <div className="sr ink-card hidden md:block overflow-hidden rounded-3xl bg-green-soft">
            <div className="px-[22px] pt-5 pb-3.5">
              <h3 className={T.h3}>Así se ve cada empresa</h3>
              <p className={`${T.body} mt-1.5 text-[#3d413e]`}>Un directorio con todas sus vacantes vigentes en un solo lugar.</p>
            </div>
            <div className="mx-[22px] overflow-hidden rounded-t-xl border-2 border-b-0 border-foreground">
              <img src="/home/empresas.webp" alt="Directorio de empresas de BuscoTrabajo" loading="lazy" className="block w-full h-[220px] object-cover object-top" />
            </div>
          </div>
        </div>

        {/* Phone: the featured card plus four tiles, two per row; desktop
            shows every tile and the dashed "ver todas" card. */}
        <div className="grid grid-cols-2 gap-3 md:flex-[1.6_1_560px] md:min-w-0 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] md:content-start">
          {rest.map((company, i) => (
            <CompanyTile key={company.company} company={company} country={country} accessToken={accessToken} className={i >= 4 ? "hidden md:flex" : "flex"} />
          ))}
          <Link
            to={directoryPath}
            className={`${T.h3} sr hidden md:flex rounded-2xl border-2 border-dashed border-foreground bg-green-soft p-4 items-center justify-center text-center text-green-deep no-underline`}
          >
            Ver {totalCompanies ? `las ${totalCompanies}` : "todas las"} empresas →
          </Link>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: "01", text: "Escribe qué buscas" },
  { n: "02", text: "Revisamos todos los portales" },
  { n: "03", text: "Quitamos repetidas y vencidas" },
  { n: "04", text: "Te postulas en la fuente original" }
];

function Video() {
  return (
    <section className="sr-host order-7 md:order-5 bg-foreground text-white">
      <div className={`${CONTAINER} ${SECTION_Y} flex flex-col md:flex-row md:flex-wrap md:items-center gap-6 md:gap-12`}>
        <div className="sr md:flex-[1_1_360px]">
          <h2 className={T.h2}>Mira cómo funciona en menos de un minuto</h2>
          <p className={`${T.body} hidden md:block mt-4 text-[#c9ccc7]`}>
            Escribes el cargo, revisamos los portales en paralelo, fusionamos las repetidas y te mostramos lo más nuevo primero.
          </p>
        </div>
        <div className="sr md:flex-[1.6_1_560px] min-w-0 overflow-hidden rounded-2xl md:rounded-[22px] border-2 border-gold-2 shadow-[5px_5px_0_hsl(var(--primary))] md:shadow-[10px_10px_0_hsl(var(--primary))]">
          <YouTubeLite />
        </div>
        {/* One numbered list for both layouts, so the steps read the same on
            every screen. */}
        <ol className="sr-stagger md:basis-full grid grid-cols-1 md:grid-cols-4 gap-3">
          {STEPS.map((step) => (
            <li key={step.n} className={`${T.body} sr flex items-center gap-3 font-semibold`}>
              <span className={`${T.small} w-9 h-9 shrink-0 rounded-[10px] border-2 border-white bg-gold-2 text-foreground grid place-items-center font-mono font-bold`}>{step.n}</span>
              {step.text}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Explore({ country, data }: { country: string; data: HomeData }) {
  const [tab, setTab] = useState<"ciudad" | "cargo">("ciudad");
  const countryConfig = getCountryConfig(country);
  const cities = getHomeCities(country);
  const remoteCount = formatCount(data.remote);
  const roles = POPULAR_ROLES;

  return (
    <section className={`sr-host order-6 ${CONTAINER} ${SECTION_Y}`}>
      <SectionHeader title="Explora ofertas de empleo" className="md:hidden" />
      <div role="tablist" aria-label="Explorar por" className="sr md:hidden grid grid-cols-2 gap-1 p-1 mb-4 rounded-[14px] border-2 border-foreground bg-white">
        {(["ciudad", "cargo"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`${T.small} h-11 rounded-[10px] font-bold ${tab === id ? "bg-foreground text-white" : "text-[#3d413e]"}`}
          >
            {id === "ciudad" ? "Por ciudad" : "Por cargo"}
          </button>
        ))}
      </div>

      <div className={tab === "ciudad" ? "" : "hidden md:block"}>
        <SectionHeader title="Ofertas de empleo por ciudad" className="hidden md:flex" />
        <div className="sr-stagger flex flex-col md:grid md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-3.5 overflow-clip md:overflow-visible rounded-2xl md:rounded-none border-2 md:border-0 border-foreground">
          {cities.map((city, i) => {
            const count = formatCount(data.cityCounts[city]);
            const lead = i === 0;
            const path = buildCategoryPath({ kind: "ciudad", label: city, country });
            return (
              <Link
                key={city}
                to={path}
                className={`sr md:ink-card ink-lift flex md:block items-center justify-between gap-2.5 min-h-[52px] px-4 md:p-6 border-b md:border-b-2 border-border md:rounded-[20px] bg-white no-underline ${
                  lead ? "md:bg-primary md:text-white" : "text-foreground"
                }`}
              >
                <span className={`${T.small} hidden md:block font-mono ${lead ? "text-[#a9d6bf]" : "text-muted-foreground"}`}>{path}</span>
                <h3 className={`${T.h3} md:mt-6 md:mb-1 text-foreground ${lead ? "md:text-white" : ""}`}>Trabajo en {city}</h3>
                {count ? (
                  <span className={`${T.small} md:text-base font-mono md:font-sans font-semibold md:font-bold text-muted-foreground ${lead ? "md:text-gold-1" : "md:text-primary"}`}>
                    {count}<span className="hidden md:inline"> vacantes →</span> <span className="md:hidden">›</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
          <Link
            to={buildCategoryPath({ kind: "ciudad", label: "Remoto", country })}
            className="sr md:ink-card ink-lift md:col-span-2 flex items-center justify-between gap-3 min-h-[52px] px-4 md:p-6 md:rounded-[20px] bg-white md:bg-foreground md:text-white md:shadow-[4px_4px_0_hsl(var(--gold-2))] no-underline"
          >
            <span>
              <span className={`${T.small} hidden md:block font-mono text-[#a3a7a2]`}>/empleos/remoto</span>
              <h3 className={`${T.h3} md:mt-6 md:mb-1 text-foreground md:text-white`}>Trabajo remoto<span className="hidden md:inline"> desde {countryConfig.name}</span></h3>
            </span>
            {remoteCount ? (
              <span className={`${T.small} md:text-base font-mono md:font-sans font-semibold md:font-bold text-muted-foreground md:text-gold-1`}>
                {remoteCount}<span className="hidden md:inline"> vacantes →</span> <span className="md:hidden">›</span>
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      <div className={tab === "cargo" ? "" : "hidden md:block"}>
        <SectionHeader title="Vacantes por cargo" className="hidden md:flex md:mt-16" />
        <div className="sr-stagger flex flex-col md:flex-row md:flex-wrap md:gap-3 overflow-clip md:overflow-visible rounded-2xl md:rounded-none border-2 md:border-0 border-foreground">
          {roles.map((role, i) => (
            <Link
              key={role}
              to={buildCategoryPath({ kind: "rol", label: role, country })}
              className={`${T.body} sr md:ink-card-sm ink-lift ${i >= 6 ? "hidden md:flex" : "flex"} items-center justify-between min-h-[52px] md:min-h-0 px-4 md:px-5 md:py-3 border-b md:border-b-2 border-border md:rounded-[14px] bg-white font-semibold md:font-bold text-foreground no-underline`}
            >
              {role}
              <span className={`${T.small} md:hidden font-mono text-muted-foreground`}>›</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Why({ data }: { data: HomeData }) {
  const fresh = formatCount(data.last24Hours);
  return (
    <section className={`sr-host order-8 md:order-7 ${CONTAINER} ${SECTION_Y}`}>
      <SectionHeader title="Por qué buscar empleo aquí" />
      <div className="sr-stagger grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-[18px]">
        <div className="sr ink-card-sm md:ink-card ink-lift overflow-hidden rounded-2xl md:rounded-3xl bg-green-soft">
          <div className="p-5 md:px-7 md:pt-7">
            <h3 className={T.h3}>Cada ciudad, con datos reales</h3>
            <p className={`${T.body} mt-2 md:mb-5 text-[#3d413e]`}>Empresas, fuentes y fecha de la última publicación.</p>
          </div>
          <div className="hidden md:block mx-7 overflow-hidden rounded-t-xl border-2 border-b-0 border-foreground">
            <img src="/home/city-bogota.webp" alt="Página de empleos en Bogotá" loading="lazy" className="block w-full h-[220px] object-cover object-top" />
          </div>
        </div>
        <div className="sr ink-card-sm md:ink-card ink-lift rounded-2xl md:rounded-3xl bg-primary text-white p-5 md:p-7 flex flex-col justify-between gap-3 md:gap-6">
          <h3 className={T.h3}>Una vacante, una vez</h3>
          <p className={`${FIGURE} text-gold-1`}>3 → 1</p>
          <p className={`${T.body} text-[#cfe7da]`}>Si la oferta está en tres portales, la ves una vez con todos sus enlaces.</p>
        </div>
        <div className="sr ink-card-sm md:ink-card ink-lift overflow-hidden rounded-2xl md:rounded-3xl bg-[#fdf1d3]">
          <div className="p-5 md:px-7 md:pt-7">
            <h3 className={T.h3}>Lo más nuevo, primero</h3>
            <p className={`${T.body} mt-2 md:mb-5 text-gold-ink`}>
              {fresh ? `${fresh} vacantes nuevas en las últimas 24 horas, ordenadas por frescura.` : "Ordenadas por fecha de publicación."}
            </p>
          </div>
          <div className="hidden md:block mx-7 overflow-hidden rounded-t-xl border-2 border-b-0 border-foreground">
            <img src="/home/dash-mobile.webp" alt="Vacantes recientes en el celular" loading="lazy" className="block w-full h-[220px] object-cover object-top" />
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta({ country }: { country: string }) {
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";
  return (
    <section className={`sr-host order-9 md:order-8 ${CONTAINER} pt-2 pb-12 md:pt-4 md:pb-24`}>
      <div className="sr overflow-hidden rounded-[20px] md:rounded-[32px] bg-green-deep text-white text-center px-5 py-10 md:px-10 md:py-20">
        <h2 className={T.h2}>La vacante que buscas ya se publicó</h2>
        <p className={`${T.body} mt-3 mb-6 md:mb-8 text-[#cfe7da]`}>Encuéntrala antes que los demás.</p>
        <Link
          to={dashboardPath}
          className="flex md:inline-flex h-[54px] md:h-[58px] items-center justify-center rounded-xl md:rounded-[14px] border-2 border-foreground bg-gold-2 px-[30px] font-heading font-bold text-base text-foreground no-underline"
        >
          Ver vacantes de hoy →
        </Link>
      </div>
    </section>
  );
}

export default function HomeLanding({ country }: { country: string }) {
  const data = useHomeData(country);
  return (
    // overflow-x-clip, not -hidden: "hidden" makes this div a scroll
    // container, which steals the sections' scroll-driven reveal timeline
    // and the page's wheel scrolling feel.
    <div className="flex flex-col overflow-x-clip bg-white">
      <Hero country={country} data={data} />
      <Portals country={country} />
      <Stats country={country} data={data} />
      <LatestJobs country={country} data={data} />
      <Companies country={country} data={data} />
      <Explore country={country} data={data} />
      <Video />
      <Why data={data} />
      <FinalCta country={country} />
    </div>
  );
}
