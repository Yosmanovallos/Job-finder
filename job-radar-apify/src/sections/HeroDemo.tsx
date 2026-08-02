import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCountryConfig } from "../countries/index.js";

export interface HeroDemoProps {
  // Defaults to "CO" so /como-funciona and /fuentes (which render this
  // outside the country-aware Landing route) keep today's exact copy.
  country?: string;
}

export default function HeroDemo({ country = "CO" }: HeroDemoProps) {
  const navigate = useNavigate();
  const [heroSearch, setHeroSearch] = useState("");
  const countryConfig = getCountryConfig(country);
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";
  // First city in the country's own list (Bogotá for CO, Caracas for VE) —
  // same list the dashboard's own city filter uses (getCityOptionsForCountry).
  const featuredCity = countryConfig.cities[0];

  // The search box and chips below all lead into the real Dashboard, and
  // whatever the user typed/picked here has to actually carry over — an
  // earlier version dropped the typed search text entirely, so submitting
  // it here silently showed unrelated results on the other end.
  const goToDashboard = (e?: React.FormEvent, params?: Record<string, string>) => {
    e?.preventDefault();
    const query = new URLSearchParams(params).toString();
    navigate(query ? `${dashboardPath}?${query}` : dashboardPath);
  };

  return (
    <section
      id="hero-demo"
      className="relative w-full overflow-x-hidden"
      style={{ background: "linear-gradient(180deg, #fdf8ec 0%, #fafafa 60%)" }}
    >
      {/* Ambient gold/green glow + faint dot grid, no boxed panel — the
          headline and search sit directly on the page like the previous
          production hero did. */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 10%, rgba(201,154,46,0.16), transparent 42%), " +
            "radial-gradient(circle at 88% 6%, rgba(15,107,76,0.12), transparent 38%), " +
            "radial-gradient(circle, rgba(14,15,16,0.05) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 26px 26px"
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Encuentra todas las vacantes de {countryConfig.name}{" "}
            <span style={{ color: "#0f6b4c" }}>en un solo lugar</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Sin duplicados, sin pestañas de más. Un solo buscador para todas las vacantes de {countryConfig.name}.
          </p>

          <form
            onSubmit={(e) => goToDashboard(e, heroSearch.trim() ? { search: heroSearch.trim() } : {})}
            className="relative max-w-lg mx-auto mb-5"
          >
            <input
              type="text"
              value={heroSearch}
              onChange={(e) => setHeroSearch(e.target.value)}
              placeholder="Ej: analista de datos, enfermería, developer..."
              className="w-full font-heading text-base font-medium py-4 pl-6 pr-14 rounded-full border border-[#d3d6cf] bg-[#ffffff] text-foreground shadow-sm focus:outline-none focus:border-gold-2 focus:ring-4 focus:ring-gold-1/40 transition-all"
            />
            <button
              type="submit"
              aria-label="Buscar vacantes"
              className="btn-gold-shine absolute right-1.5 top-1.5 bottom-1.5 w-11 rounded-full bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink flex items-center justify-center font-bold"
            >
              →
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => goToDashboard(undefined, { freshness: "48h" })}
              className="text-xs font-mono px-3.5 py-1.5 rounded-full border border-primary/40 bg-green-soft text-green-deep"
            >
              Últimas 48h
            </button>
            <button
              onClick={() => goToDashboard(undefined, { modality: "remoto" })}
              className="text-xs font-mono px-3.5 py-1.5 rounded-full border border-[#d3d6cf] text-muted-foreground hover:border-primary/40 hover:text-green-deep transition-colors"
            >
              Remoto
            </button>
            <button
              onClick={() => goToDashboard(undefined, { cities: featuredCity })}
              className="text-xs font-mono px-3.5 py-1.5 rounded-full border border-[#d3d6cf] text-muted-foreground hover:border-primary/40 hover:text-green-deep transition-colors"
            >
              {featuredCity}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
