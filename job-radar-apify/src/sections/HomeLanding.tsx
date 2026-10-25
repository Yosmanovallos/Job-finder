import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCountryConfig, SOURCES_BY_COUNTRY } from "../countries/index.js";
import { getHomeContent } from "../lib/agent-readiness.js";
import { buildCategoryPath, buildCompanyPath, buildJobPath } from "../lib/job-seo.js";
import { jobDateLabel } from "../lib/job-date-label.js";
import { getSourceColor } from "../lib/source-colors.js";
import { getSourceLogoUrl } from "../lib/source-logos.js";
import { formatCount, useHomeData, type HomeCompany, type HomeData } from "../lib/use-home-data.js";
import { getHomeCities } from "../lib/home-stats.js";
import { CompanyAvatar } from "../components/CompanyAvatar.js";

// Homepage approved on the design canvas (R3, 2026-10-25): one DOM for both
// layouts — sections only change arrangement at `md`, and the phone order
// differs from desktop through CSS `order` (phone: stats + "lo más nuevo"
// right after the portals; desktop has no "lo más nuevo" strip). The <h1>
// is getHomeContent().heading verbatim because server.ts injects that same
// string into the raw HTML before hydration.

// Light tints cycled across city cards / steps — same family as the
// source-badge colors so the page gets color without new brand hues.
const TINTS = [
  { bg: "#fdf1d3", fg: "#2a1d06", sub: "#7a5a0f" },
  { bg: "#e8f1fb", fg: "#082f5c", sub: "#0a4f96" },
  { bg: "#fde8dc", fg: "#4a1c05", sub: "#9a3d0c" },
  { bg: "#e4f6f5", fg: "#063d3b", sub: "#0b6f6b" },
  { bg: "#efe9fd", fg: "#2e1065", sub: "#6d28d9" }
];

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

function SourceLogo({ source }: { source: string }) {
  const [failed, setFailed] = useState(false);
  const url = getSourceLogoUrl(source);
  const color = getSourceColor(source.replace(/ Jobs$/, ""));
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        width={28}
        height={28}
        decoding="async"
        onError={() => setFailed(true)}
        className="w-6 h-6 md:w-7 md:h-7 rounded-md object-contain bg-white"
      />
    );
  }
  return (
    <span aria-hidden="true" className="w-6 h-6 md:w-7 md:h-7 rounded-md grid place-items-center text-xs font-bold text-white" style={{ backgroundColor: color.text }}>
      {source.charAt(0)}
    </span>
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
    <section className="order-1 bg-gradient-to-b from-green-soft to-white md:bg-none">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-6 pb-7 md:pt-10 md:pb-16 flex flex-wrap items-center gap-10">
        <div className="flex-[1_1_460px] min-w-0">
          <p className="ink-card-sm inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] pl-2 pr-3 py-1 text-[13px] md:text-sm font-semibold mb-4 shadow-none">
            <span aria-hidden="true" className="home-live-dot w-2.5 h-2.5 rounded-full bg-primary" />
            {total ? `${total} vacantes activas en ${countryConfig.name}` : `Vacantes activas en ${countryConfig.name}`}
          </p>
          <h1 className="font-heading font-bold tracking-[-0.045em] leading-[1.04] md:leading-none text-[34px] md:text-[clamp(40px,5vw,66px)]">
            {headingLead}: <span className="text-primary">{headingTail}</span>
          </h1>
          <p className="mt-3 md:mt-5 max-w-[540px] text-[15px] md:text-[19px] leading-relaxed text-[#3d413e]">
            Una sola búsqueda en {SOURCES_BY_COUNTRY[country]?.slice(1, 4).join(", ") ?? "los principales portales"} y más. Sin repetidas, sin vencidas, gratis.
          </p>

          <form
            role="search"
            onSubmit={submit}
            className="ink-card mt-5 md:mt-7 max-w-[620px] rounded-[18px] md:rounded-[22px] bg-white p-2.5 md:p-3.5 flex flex-col md:flex-row md:flex-wrap gap-2 md:gap-2.5 md:shadow-[6px_6px_0_hsl(var(--foreground))]"
          >
            <label htmlFor="home-search" className="hidden md:block w-full font-mono text-xs font-semibold tracking-wider text-muted-foreground">
              ¿QUÉ TRABAJO BUSCAS?
            </label>
            <div className="relative md:basis-full min-w-0">
              <SearchIcon className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground md:hidden" />
              <input
                id="home-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="¿Qué trabajo buscas?"
                aria-label="¿Qué trabajo buscas?"
                className="w-full h-[54px] md:h-[62px] rounded-xl md:rounded-[14px] border-2 border-foreground bg-[#fbfaf6] pl-11 md:pl-[18px] pr-4 text-[17px] md:text-lg focus:outline-none focus:ring-4 focus:ring-gold-1/60"
              />
            </div>
            <button
              type="submit"
              className="md:basis-full whitespace-nowrap h-[54px] md:h-[62px] rounded-xl md:rounded-[14px] border-2 border-foreground bg-gold-2 text-foreground font-heading font-bold text-[17px] md:text-lg flex items-center justify-center gap-2.5"
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
          <div className="relative overflow-hidden rounded-[32px] border-2 border-foreground bg-gradient-to-br from-primary to-green-deep py-11 pl-11">
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
            <div className="ink-card-sm absolute right-2.5 top-0 rounded-[14px] bg-white px-4 py-3 text-sm rotate-2">
              <strong>{formatCount(data.last24Hours)}</strong> nuevas en 24 h
            </div>
          ) : null}
          {formatCount(data.remote) ? (
            <div className="ink-card-sm absolute right-8 bottom-2.5 rounded-[14px] bg-[#fdf1d3] px-4 py-3 text-sm -rotate-1">
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
  const chip = (source: string, hidden: boolean) => (
    <span
      key={`${source}-${hidden ? "b" : "a"}`}
      aria-hidden={hidden || undefined}
      className="inline-flex items-center gap-2 rounded-full border-2 border-foreground bg-white py-1 pl-1 pr-3 md:py-1.5 md:pl-1.5 md:pr-4 font-heading font-bold text-[13px] md:text-[15px] whitespace-nowrap"
    >
      <SourceLogo source={source} />
      {source}
    </span>
  );
  return (
    <section aria-label="Portales que reúne BuscoTrabajo" className="order-2 overflow-hidden border-y-2 border-foreground bg-[#fdf1d3] py-2.5 md:py-[18px]">
      <div className="marquee-track flex w-max gap-2 md:gap-3.5">
        {sources.map((s) => chip(s, false))}
        {sources.map((s) => chip(s, true))}
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
    { value: data.totalJobs, label: "ofertas de empleo activas", color: "text-white", phone: true },
    { value: data.last7Days, label: "publicadas en los últimos 7 días", color: "text-white", phone: true },
    { value: data.onSite, label: "presenciales", color: "text-white", phone: false },
    { value: data.remote, label: "remotas", color: "text-[#7fe0b4]", phone: true },
    { value: data.totalCompanies, label: "empresas en nuestro portal", color: "text-gold-1", phone: true }
  ];
  return (
    <section className="sr-host order-3 px-4 py-5 md:p-0">
      <div className="relative overflow-clip rounded-[20px] md:rounded-none bg-[#06110d] text-white">
        <div aria-hidden="true" className="absolute -left-48 -top-72 w-[900px] h-[700px] rounded-full bg-[radial-gradient(closest-side,rgba(15,107,76,0.7),rgba(15,107,76,0))]" />
        <div aria-hidden="true" className="hidden md:block absolute -right-48 -bottom-72 w-[800px] h-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(212,165,55,0.35),rgba(212,165,55,0))]" />
        <div className="relative max-w-[1240px] mx-auto p-5 md:px-6 md:py-[72px]">
          <h2 className="sr font-heading font-bold text-lg md:text-[34px] tracking-[-0.03em] mb-3.5 md:mb-9">
            El empleo en {countryName} hoy
          </h2>
          <div className="sr-stagger grid grid-cols-2 md:grid-cols-5 gap-x-3 gap-y-4 md:gap-0">
            {items.map((item) => (
              <div key={item.label} className={`sr ${item.phone ? "" : "hidden md:block"} md:py-6 md:pr-6 md:border-t md:border-white/15`}>
                <StatValue value={item.value} className={`font-heading font-bold md:font-semibold leading-none tracking-[-0.03em] text-[30px] md:text-[54px] ${item.color}`} />
                <p className="mt-1 md:mt-2.5 text-xs md:text-base text-[#b5c2ba]">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function LatestJobs({ country, data }: { country: string; data: HomeData }) {
  if (data.latestJobs.length === 0) return null;
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";
  return (
    <section className="sr-host order-4 md:hidden px-4 pt-1.5 pb-6">
      <div className="sr flex items-baseline justify-between mb-2.5">
        <h2 className="font-heading font-bold text-xl tracking-[-0.02em]">Lo más nuevo ahora</h2>
        <Link to={dashboardPath} className="text-sm font-semibold">Ver todo</Link>
      </div>
      <div className="sr-m home-rail -mx-4 px-4 pt-1 pb-2.5 flex gap-2.5 overflow-x-auto">
        {data.latestJobs.map((job) => {
          const color = getSourceColor(job.source);
          return (
            <article key={job.jobId} className="sr-card ink-card-sm shrink-0 w-[286px] rounded-2xl bg-white p-3.5 flex flex-col gap-2.5">
              <div className="flex gap-2.5">
                <CompanyAvatar name={job.company} logoUrl={null} className="w-[42px] h-[42px] text-base" />
                <div className="min-w-0">
                  <h3 className="font-heading font-bold text-[15px] leading-tight line-clamp-2">{job.title}</h3>
                  <p className="mt-0.5 text-[13px] text-muted-foreground truncate">{job.company} · {job.location}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ backgroundColor: color.bg, color: color.text }}>{job.source}</span>
                <span className="rounded-full px-2 py-0.5 font-mono text-[11px] bg-green-soft text-primary">{jobDateLabel(job)}</span>
              </div>
              <Link to={buildJobPath(job)} className="mt-auto h-11 rounded-[10px] bg-primary text-white font-bold text-sm flex items-center justify-center">
                Ver vacante →
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CompanyTile({ company, country }: { company: HomeCompany; country: string }) {
  return (
    <Link
      to={buildCompanyPath(company.company, country)}
      className="sr-card ink-card-sm ink-lift snap-start shrink-0 w-[140px] md:w-auto rounded-2xl bg-white p-3.5 md:p-4 flex flex-col md:flex-row md:items-center gap-2.5 md:gap-3 text-foreground no-underline"
    >
      <CompanyAvatar name={company.company} logoUrl={company.logoUrl} className="w-10 h-10 md:w-11 md:h-11 text-lg" />
      <span className="min-w-0">
        <strong className="block font-heading font-bold text-[15px] md:text-base truncate">{company.company}</strong>
        <span className="text-[13px] text-muted-foreground">{company.count.toLocaleString("es-CO")} vacantes</span>
      </span>
    </Link>
  );
}

function Companies({ country, data }: { country: string; data: HomeData }) {
  if (data.companies.length === 0) return null;
  const [featured, ...rest] = data.companies;
  const directoryPath = country === "VE" ? "/ve/empresas" : "/empresas";
  const countryName = getCountryConfig(country).name;
  const totalCompanies = formatCount(data.totalCompanies);
  return (
    <section className="sr-host order-5 md:order-4 max-w-[1240px] w-full mx-auto px-4 md:px-6 pt-1 pb-6 md:pt-[104px] md:pb-[72px]">
      <div className="sr flex md:flex-wrap items-baseline md:items-end justify-between gap-4 mb-2.5 md:mb-9">
        <h2 className="min-w-0 font-heading font-bold tracking-[-0.02em] md:tracking-[-0.04em] text-[22px] md:text-[52px] leading-tight md:leading-[1.02] max-w-[720px]">
          Empresas que están contratando<span className="hidden md:inline"> en {countryName}</span>
        </h2>
        <Link to={directoryPath} className="md:hidden shrink-0 whitespace-nowrap text-sm font-semibold">Ver todas</Link>
        <Link to={directoryPath} className="ink-card-sm ink-lift hidden md:inline-flex h-[50px] items-center rounded-[14px] bg-white px-5 font-bold text-foreground no-underline">
          Ver {totalCompanies ? `las ${totalCompanies} empresas` : "todas las empresas"} →
        </Link>
      </div>

      <div className="sr-m home-rail -mx-4 px-4 pt-1 pb-2.5 md:m-0 md:p-0 flex md:flex-wrap gap-2.5 md:gap-5 overflow-x-auto md:overflow-visible">
        <div className="shrink-0 md:flex-[1_1_380px] md:min-w-0 flex flex-col gap-5">
          <Link
            to={buildCompanyPath(featured.company, country)}
            className="sr-card ink-card ink-lift snap-start block w-[200px] md:w-auto rounded-2xl md:rounded-3xl bg-[#fdf1d3] p-3.5 md:p-7 text-foreground no-underline"
          >
            <div className="flex flex-col md:flex-row md:items-center gap-2.5 md:gap-4">
              <CompanyAvatar name={featured.company} logoUrl={featured.logoUrl} className="w-10 h-10 md:w-16 md:h-16 text-2xl border-2 border-foreground" />
              <div>
                <p className="hidden md:block font-mono text-xs font-semibold text-gold-3">LA QUE MÁS CONTRATA HOY</p>
                <h3 className="font-heading font-bold text-base md:text-[28px]">{featured.company}</h3>
              </div>
            </div>
            <p className="mt-0.5 md:mt-5 font-heading font-bold text-[26px] md:text-[64px] leading-none tracking-[-0.04em]">
              {featured.count.toLocaleString("es-CO")} <span className="text-[13px] md:text-xl tracking-normal font-semibold">vacantes<span className="hidden md:inline"> activas</span></span>
            </p>
            <p className="hidden md:block mt-3.5 font-bold text-primary">Ver vacantes de {featured.company} →</p>
          </Link>
          <div className="sr ink-card hidden md:block overflow-hidden rounded-3xl bg-[#e8f1fb]">
            <div className="px-[22px] pt-5 pb-3.5">
              <h3 className="font-heading font-bold text-xl">Así se ve cada empresa</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#3d413e]">Un directorio con todas sus vacantes vigentes en un solo lugar.</p>
            </div>
            <div className="mx-[22px] overflow-hidden rounded-t-xl border-2 border-b-0 border-foreground">
              <img src="/home/empresas.webp" alt="Directorio de empresas de BuscoTrabajo" loading="lazy" className="block w-full h-[220px] object-cover object-top" />
            </div>
          </div>
        </div>

        <div className="contents md:grid md:flex-[1.6_1_560px] md:min-w-0 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] md:gap-3 md:content-start">
          {rest.map((company, i) => (
            <div key={company.company} className={i >= 6 ? "hidden md:contents" : "contents"}>
              <CompanyTile company={company} country={country} />
            </div>
          ))}
          <Link
            to={directoryPath}
            className="sr-card snap-start shrink-0 w-[140px] md:w-auto rounded-2xl border-2 border-dashed border-foreground bg-green-soft p-4 flex items-center justify-center text-center font-heading font-bold text-green-deep no-underline"
          >
            Ver {totalCompanies ? `las ${totalCompanies}` : "todas las"} empresas →
          </Link>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: "01", text: "Escribe qué buscas", bg: "bg-green-soft", fg: "text-primary" },
  { n: "02", text: "Revisamos todos los portales", bg: "bg-[#fdf1d3]", fg: "text-gold-3" },
  { n: "03", text: "Quitamos repetidas y vencidas", bg: "bg-[#e8f1fb]", fg: "text-[#0a4f96]" },
  { n: "04", text: "Te postulas en la fuente original", bg: "bg-[#fde8dc]", fg: "text-[#9a3d0c]" }
];

// "Lite embed": until the visitor clicks, this is a self-hosted thumbnail
// (YouTube's own maxresdefault, so it matches what plays) inside a plain
// link to the video — no YouTube script, cookie or connection on page load.
// The click swaps in the youtube-nocookie iframe with autoplay. Without JS
// the link still opens the video on YouTube.
const YOUTUBE_ID = "R0qO40Sbtw0";
const YOUTUBE_TITLE = "Busca empleo sin abrir diez portales | buscotrabajo.co";

function YouTubeLite() {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video bg-white">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0&playsinline=1`}
          title={YOUTUBE_TITLE}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
        />
      ) : (
        <a
          href={`https://www.youtube.com/watch?v=${YOUTUBE_ID}`}
          onClick={(event) => {
            event.preventDefault();
            setPlaying(true);
          }}
          aria-label="Reproducir video: cómo funciona BuscoTrabajo"
          className="group absolute inset-0 block"
        >
          <img
            src="/home/como-funciona-video.webp"
            alt=""
            width={1280}
            height={720}
            loading="lazy"
            decoding="async"
            className="block w-full h-full object-cover"
          />
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 md:w-20 md:h-20 rounded-full bg-primary border-2 border-white shadow-[3px_3px_0_hsl(var(--foreground))] md:shadow-[5px_5px_0_hsl(var(--foreground))] grid place-items-center transition-transform group-hover:scale-110 group-focus-visible:scale-110"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 md:w-8 md:h-8 ml-1 fill-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </a>
      )}
    </div>
  );
}

function Video() {
  return (
    <section className="sr-host order-7 md:order-5 bg-foreground text-white md:border-t-2 md:border-foreground">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 py-[26px] md:py-[104px] flex flex-col md:flex-row md:flex-wrap md:items-center gap-4 md:gap-12">
        <div className="sr md:flex-[1_1_360px]">
          <h2 className="font-heading font-bold text-[26px] md:text-[52px] leading-[1.08] md:leading-[1.02] tracking-[-0.03em] md:tracking-[-0.04em]">
            Mira cómo funciona en menos de un minuto
          </h2>
          <p className="hidden md:block mt-[18px] text-[17px] leading-relaxed text-[#c9ccc7]">
            Escribes el cargo, revisamos los portales en paralelo, fusionamos las repetidas y te mostramos lo más nuevo primero.
          </p>
          <ol className="hidden md:flex mt-7 flex-col gap-3">
            {STEPS.map((step) => (
              <li key={step.n} className="flex items-center gap-3.5 font-semibold">
                <span className={`w-10 h-10 rounded-xl border-2 border-white grid place-items-center font-mono font-bold text-sm ${step.bg} ${step.fg}`}>{step.n}</span>
                {step.text}
              </li>
            ))}
          </ol>
        </div>
        <div className="sr md:flex-[1.6_1_560px] min-w-0 overflow-hidden rounded-2xl md:rounded-[22px] border-2 border-gold-2 shadow-[5px_5px_0_hsl(var(--primary))] md:shadow-[10px_10px_0_hsl(var(--primary))]">
          <YouTubeLite />
        </div>
        <ol className="sr-stagger md:hidden grid grid-cols-2 gap-2">
          {STEPS.map((step) => (
            <li key={step.n} className={`sr rounded-xl border-2 border-white p-2.5 text-[13px] font-bold text-foreground ${step.bg}`}>
              <span className={`font-mono text-xs ${step.fg}`}>{step.n}</span>
              <br />
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
  const chipTints = ["#e6f4ec", "#fdf1d3", "#e8f1fb"];

  return (
    <section className="sr-host order-6 max-w-[1240px] w-full mx-auto px-4 md:px-6 pt-1 pb-6 md:pt-[104px] md:pb-10">
      <h2 className="sr md:hidden font-heading font-bold text-[22px] tracking-[-0.02em] mb-3">Explora ofertas de empleo</h2>
      <div role="tablist" aria-label="Explorar por" className="sr md:hidden grid grid-cols-2 gap-1 p-1 mb-3 rounded-[14px] border-2 border-foreground bg-[#fbfaf6]">
        {(["ciudad", "cargo"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-11 rounded-[10px] text-sm font-bold ${tab === id ? "bg-foreground text-white" : "text-[#3d413e]"}`}
          >
            {id === "ciudad" ? "Por ciudad" : "Por cargo"}
          </button>
        ))}
      </div>

      <div className={tab === "ciudad" ? "" : "hidden md:block"}>
        <div className="sr hidden md:flex flex-wrap items-end justify-between gap-4 mb-8">
          <h2 className="font-heading font-bold text-[52px] leading-[1.02] tracking-[-0.04em]">Ofertas de empleo por ciudad</h2>
        </div>
        <div className="sr-stagger flex flex-col md:grid md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-3.5 overflow-clip md:overflow-visible rounded-2xl md:rounded-none border-2 md:border-0 border-foreground">
          {cities.map((city, i) => {
            const count = formatCount(data.cityCounts[city]);
            const tint = i === 0 ? null : TINTS[(i - 1) % TINTS.length];
            const path = buildCategoryPath({ kind: "ciudad", label: city, country });
            return (
              <Link
                key={city}
                to={path}
                className={`sr md:ink-card ink-lift flex md:block items-center justify-between gap-2.5 min-h-[52px] px-3.5 md:p-[26px] border-b md:border-b-2 border-border md:rounded-[20px] bg-white no-underline ${
                  tint ? "md:bg-[var(--c-bg)] md:text-[color:var(--c-fg)]" : "md:bg-gradient-to-br md:from-primary md:to-green-deep md:text-white"
                }`}
                style={tint ? ({ "--c-bg": tint.bg, "--c-fg": tint.fg } as React.CSSProperties) : undefined}
              >
                <span className="hidden md:block font-mono text-xs" style={{ color: tint ? tint.sub : "#a9d6bf" }}>{path}</span>
                <span className="flex items-center gap-2.5 md:block">
                  <span aria-hidden="true" className="md:hidden w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: tint ? tint.sub : "#0f6b4c" }} />
                  <h3 className="font-semibold md:font-bold text-[15px] md:text-[26px] md:font-heading md:mt-[30px] md:mb-1 text-foreground md:text-inherit">Trabajo en {city}</h3>
                </span>
                {count ? (
                  <span className={`font-mono md:font-sans text-[13px] md:text-base font-semibold md:font-bold text-muted-foreground ${tint ? "md:text-inherit" : "md:text-gold-1"}`}>
                    {count}<span className="hidden md:inline"> vacantes →</span> <span className="md:hidden">›</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
          <Link
            to={buildCategoryPath({ kind: "ciudad", label: "Remoto", country })}
            className="sr md:ink-card ink-lift md:col-span-2 flex items-center justify-between gap-3 min-h-[52px] px-3.5 md:p-[26px] md:rounded-[20px] bg-white md:bg-foreground md:text-white md:shadow-[4px_4px_0_hsl(var(--gold-2))] no-underline"
          >
            <span className="flex items-center gap-2.5 md:block">
              <span aria-hidden="true" className="md:hidden w-2.5 h-2.5 rounded-[3px] bg-[#7C3AED]" />
              <span>
                <span className="hidden md:block font-mono text-xs text-[#a3a7a2]">/empleos/remoto</span>
                <h3 className="font-semibold md:font-bold text-[15px] md:text-[30px] md:font-heading md:mt-[30px] md:mb-1 text-foreground md:text-white">Trabajo remoto<span className="hidden md:inline"> desde {countryConfig.name}</span></h3>
              </span>
            </span>
            {remoteCount ? (
              <span className="font-mono md:font-sans text-[13px] md:text-base font-semibold md:font-bold text-muted-foreground md:text-gold-1">
                {remoteCount}<span className="hidden md:inline"> vacantes →</span> <span className="md:hidden">›</span>
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      <div className={`${tab === "cargo" ? "" : "hidden md:block"} md:mt-0`}>
        <h2 className="sr hidden md:block font-heading font-bold text-[52px] leading-[1.02] tracking-[-0.04em] mb-7 md:pt-[104px]">Vacantes por cargo</h2>
        <div className="sr-stagger flex flex-col md:flex-row md:flex-wrap md:gap-3 overflow-clip md:overflow-visible rounded-2xl md:rounded-none border-2 md:border-0 border-foreground">
          {roles.map((role, i) => (
            <Link
              key={role}
              to={buildCategoryPath({ kind: "rol", label: role, country })}
              className={`sr md:ink-card-sm ink-lift ${i >= 6 ? "hidden md:flex" : "flex"} items-center justify-between min-h-[52px] md:min-h-0 px-3.5 md:px-5 md:py-3.5 border-b md:border-b-2 border-border md:rounded-[14px] font-semibold md:font-bold text-[15px] text-foreground no-underline ${i < 3 ? "md:bg-[var(--chip)]" : "bg-white"}`}
              style={i < 3 ? ({ "--chip": chipTints[i] } as React.CSSProperties) : undefined}
            >
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="md:hidden w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: TINTS[i % TINTS.length].sub }} />
                {role}
              </span>
              <span className="md:hidden font-mono text-[13px] text-muted-foreground">›</span>
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
    <section className="sr-host order-8 md:order-7 max-w-[1240px] w-full mx-auto px-4 md:px-6 pt-[26px] pb-6 md:py-16">
      <h2 className="sr font-heading font-bold text-[22px] md:text-[52px] leading-tight md:leading-[1.02] tracking-[-0.02em] md:tracking-[-0.04em] mb-3 md:mb-8">
        Por qué buscar empleo aquí
      </h2>
      <div className="sr-m sr-stagger home-rail -mx-4 px-4 pt-1 pb-2.5 md:m-0 md:p-0 flex md:grid md:grid-cols-3 gap-2.5 md:gap-[18px] overflow-x-auto md:overflow-visible">
        <div className="sr-card ink-card-sm md:ink-card ink-lift shrink-0 w-[260px] md:w-auto overflow-hidden rounded-2xl md:rounded-3xl bg-green-soft">
          <div className="p-4 md:px-7 md:pt-7">
            <h3 className="font-heading font-bold text-[17px] md:text-2xl">Cada ciudad, con datos reales</h3>
            <p className="mt-2 md:mb-5 text-[13px] md:text-base leading-relaxed text-[#3d413e]">Empresas, fuentes y fecha de la última publicación.</p>
          </div>
          <div className="hidden md:block mx-7 overflow-hidden rounded-t-xl border-2 border-b-0 border-foreground">
            <img src="/home/city-bogota.webp" alt="Página de empleos en Bogotá" loading="lazy" className="block w-full h-[220px] object-cover object-top" />
          </div>
        </div>
        <div className="sr-card ink-card-sm md:ink-card ink-lift shrink-0 w-[260px] md:w-auto rounded-2xl md:rounded-3xl bg-gradient-to-br from-primary to-green-deep text-white p-4 md:p-7 flex flex-col justify-between gap-2 md:gap-6">
          <h3 className="font-heading font-bold text-[17px] md:text-2xl">Una vacante, una vez</h3>
          <p className="font-heading font-bold text-[44px] md:text-[72px] leading-none tracking-[-0.04em] text-gold-1">3 → 1</p>
          <p className="text-[13px] md:text-base leading-relaxed text-[#cfe7da]">Si la oferta está en tres portales, la ves una vez con todos sus enlaces.</p>
        </div>
        <div className="sr-card ink-card-sm md:ink-card ink-lift shrink-0 w-[260px] md:w-auto overflow-hidden rounded-2xl md:rounded-3xl bg-[#fdf1d3]">
          <div className="p-4 md:px-7 md:pt-7">
            <h3 className="font-heading font-bold text-[17px] md:text-2xl">Lo más nuevo, primero</h3>
            {fresh ? <p className="md:hidden my-2 font-heading font-bold text-[44px] leading-none">{fresh}</p> : null}
            <p className="mt-2 md:mb-5 text-[13px] md:text-base leading-relaxed text-gold-ink">
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
    <section className="sr-host order-9 md:order-8 px-4 md:px-6 pb-[26px] md:pb-[104px]">
      <div className="sr relative overflow-hidden max-w-[1240px] mx-auto rounded-[20px] md:rounded-[32px] bg-green-deep text-white text-center px-5 py-[26px] md:px-10 md:py-20">
        <div aria-hidden="true" className="absolute -left-28 -top-48 w-[520px] h-[520px] rounded-full bg-[radial-gradient(circle,rgba(212,165,55,0.55),rgba(212,165,55,0)_65%)]" />
        <div aria-hidden="true" className="absolute -right-28 -bottom-64 w-[520px] h-[520px] rounded-full bg-[radial-gradient(circle,rgba(31,163,122,0.6),rgba(31,163,122,0)_65%)]" />
        <h2 className="relative font-heading font-bold text-2xl md:text-[clamp(32px,5vw,60px)] leading-[1.1] md:leading-[1.02] tracking-[-0.02em] md:tracking-[-0.04em]">
          La vacante que buscas ya se publicó
        </h2>
        <p className="relative hidden md:block mt-3.5 mb-[30px] text-lg text-[#cfe7da]">Encuéntrala antes que los demás.</p>
        <Link
          to={dashboardPath}
          className="relative mt-4 md:mt-0 flex md:inline-flex h-[52px] md:h-[58px] items-center justify-center rounded-xl md:rounded-[14px] bg-gold-2 px-[30px] font-bold text-[#2a1d06] no-underline"
        >
          Ver vacantes de hoy →
        </Link>
      </div>
    </section>
  );
}

function BottomNav({ country }: { country: string }) {
  const prefix = country === "VE" ? "/ve" : "";
  const item = "flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold no-underline";
  return (
    <nav aria-label="Navegación inferior" className="md:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 h-16 border-t-2 border-foreground bg-white pb-[env(safe-area-inset-bottom)]">
      <Link to={prefix || "/"} className={`${item} text-primary`}>
        <svg aria-hidden="true" className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7v9H3z" /></svg>
        Inicio
      </Link>
      <Link to={`${prefix}/dashboard`} className={`${item} text-foreground`}>
        <span className="w-11 h-[30px] rounded-[10px] border-2 border-foreground bg-gold-2 grid place-items-center"><SearchIcon className="w-[18px] h-[18px]" /></span>
        Buscar
      </Link>
      <Link to={`${prefix}/empresas`} className={`${item} text-[#3d413e]`}>
        <svg aria-hidden="true" className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4" /></svg>
        Empresas
      </Link>
      <Link to="/cuenta" className={`${item} text-[#3d413e]`}>
        <svg aria-hidden="true" className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
        Guardadas
      </Link>
    </nav>
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
      <BottomNav country={country} />
    </div>
  );
}
