import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Check } from "lucide-react";
import { useAuth } from "../auth/auth-provider.js";
import { PAYWALL_ENABLED } from "../config.js";
import { FlagIcon } from "../components/FlagIcon.js";
import { getEffectiveCountry, setStoredCountry, isVePrefixed } from "../lib/country-context.js";

// "Empresas" is the one nav link that's actually country-scoped (see
// server.ts's /api/companies/* country filter) — /ve/empresas vs /empresas,
// picked at render time below. The rest (Cómo funciona/Precios/Preguntas)
// are shared informational pages, not job-data pages, so they stay
// unprefixed for both countries.
function getNavLinks(isVenezuela: boolean) {
  return [
    { label: "Cómo funciona", to: "/como-funciona" },
    { label: "Empresas", to: isVenezuela ? "/ve/empresas" : "/empresas" },
    ...(PAYWALL_ENABLED ? [{ label: "Precios", to: "/pricing" }] : []),
    { label: "Preguntas", to: "/preguntas" }
  ];
}

const COUNTRY_LABELS: Record<string, string> = { CO: "Colombia", VE: "Venezuela" };
const COUNTRY_ORDER = ["CO", "VE"];

// Maps the current path to its equivalent under a TARGET country, keeping
// the visitor on the same kind of page (landing stays landing, dashboard
// stays dashboard, empresas/company page stays empresas) instead of always
// bouncing to the dashboard regardless of where the switch was clicked
// from. Anything not covered here (login, pricing, legal, account, job
// detail pages...) isn't country-scoped at all — those pages render
// identical content either way, so switching from there just remembers the
// preference (see AppRoutes' redirect gate in App.tsx) and lands on that
// country's dashboard, the closest "still useful" destination.
function getCountryTargetHref(pathname: string, targetCode: string): string {
  const alreadyVe = isVePrefixed(pathname);
  if (targetCode === "VE") {
    if (alreadyVe) return pathname;
    if (pathname === "/") return "/ve";
    if (pathname === "/dashboard") return "/ve/dashboard";
    if (pathname === "/empresas") return "/ve/empresas";
    if (pathname.startsWith("/empresas/")) return `/ve${pathname}`;
    return "/ve/dashboard";
  }
  if (!alreadyVe) return pathname;
  if (pathname === "/ve") return "/";
  if (pathname === "/ve/dashboard") return "/dashboard";
  if (pathname === "/ve/empresas") return "/empresas";
  if (pathname.startsWith("/ve/empresas/")) return pathname.slice(3);
  return "/dashboard";
}

interface CountrySwitcherProps {
  country: string;
  pathname: string;
  variant: "desktop" | "mobile";
  onNavigate?: () => void;
}

// Flag dropdown (desktop) / flag row (mobile, already inside a full-height
// panel so a nested dropdown would just add a tap for no reason) replacing
// the old single-pill "toggle to the other country" button — this shows
// BOTH options at once, same size, with the current one visibly marked,
// instead of making the visitor infer what clicking the pill will do.
function CountrySwitcher({ country, pathname, variant, onNavigate }: CountrySwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSelect = (code: string) => {
    setStoredCountry(code);
    setOpen(false);
    onNavigate?.();
  };

  const optionClass = (code: string) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm no-underline ${
      code === country ? "bg-green-soft font-bold text-foreground" : "text-[#3d413e] hover:bg-[#f4f5f2]"
    }`;

  if (variant === "mobile") {
    return (
      <div className="flex items-center gap-2">
        {COUNTRY_ORDER.map((code) => (
          <Link
            key={code}
            to={getCountryTargetHref(pathname, code)}
            onClick={() => handleSelect(code)}
            className={`flex-1 min-h-[48px] justify-center rounded-xl border-2 ${
              code === country
                ? "border-foreground bg-green-soft font-bold shadow-[3px_3px_0_hsl(var(--foreground))]"
                : "border-foreground/20 bg-white"
            } flex items-center gap-2 text-sm text-foreground no-underline`}
          >
            <FlagIcon code={code} className="w-5 h-3.5 shrink-0" />
            {COUNTRY_LABELS[code]}
            {code === country && <Check className="h-4 w-4 text-primary" />}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`País: ${COUNTRY_LABELS[country]}. Cambiar país`}
        className="flex items-center gap-1.5 h-11 rounded-full border-2 border-foreground bg-white px-3 text-sm font-bold text-foreground transition-colors hover:bg-green-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-1/60"
      >
        <FlagIcon code={country} className="w-5 h-3.5 shrink-0" />
        <span className="font-mono">{country}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+8px)] z-[60] min-w-[180px] flex flex-col gap-1 rounded-xl border-2 border-foreground bg-white p-1.5 shadow-[4px_4px_0_hsl(var(--foreground))]"
        >
          {COUNTRY_ORDER.map((code) => (
            <Link
              key={code}
              to={getCountryTargetHref(pathname, code)}
              role="option"
              aria-selected={code === country}
              onClick={() => handleSelect(code)}
              className={optionClass(code)}
            >
              <FlagIcon code={code} className="w-5 h-3.5 shrink-0" />
              {COUNTRY_LABELS[code]}
              {code === country && <Check className="h-4 w-4 ml-auto text-primary" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { isAuthenticated, tier, user, loading } = useAuth();
  const location = useLocation();
  // Skip return_to when already on an auth-flow page — logging in from
  // /login itself, or from the post-OAuth callback, shouldn't loop back there.
  const skipReturnTo = ["/login", "/auth/callback", "/reset-password"].includes(location.pathname);
  const loginHref = skipReturnTo
    ? "/login"
    : `/login?return_to=${encodeURIComponent(location.pathname + location.search)}`;

  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  const handleNavClick = () => {
    setMobileNavOpen(false);
  };

  const accountLabel = tier === "pro" ? `🌟 ${user?.email}` : user?.email || "Mi cuenta";

  // getEffectiveCountry (not a raw "/ve" prefix check) so the header still
  // reflects a stored Venezuela preference on pages that don't carry the
  // prefix themselves (Cómo funciona, Preguntas...) — see
  // src/lib/country-context.ts.
  const country = getEffectiveCountry(location.pathname);
  const isVenezuela = country === "VE";
  const navLinks = getNavLinks(isVenezuela);
  const homeHref = isVenezuela ? "/ve" : "/";
  const dashboardHref = isVenezuela ? "/ve/dashboard" : "/dashboard";

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);
  const ghostButton =
    "ink-card-sm ink-lift inline-flex h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-bold text-foreground no-underline";
  const ctaButton =
    "ink-card-sm ink-lift inline-flex h-11 items-center justify-center rounded-xl bg-gold-2 px-5 text-sm font-bold text-[#2a1d06] no-underline";

  // Same look as the rest of the redesign: ink outline, hard offset shadows,
  // gold call to action. Height stays 64px: the dashboard's sticky search
  // bar sits at top-16 right under it.
  return (
    <header id="header" className="sticky top-0 z-50 w-full border-b-2 border-foreground bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 md:px-6">
        <Link
          to={homeHref}
          className="flex shrink-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-1/60"
          aria-label="BuscoTrabajo — inicio"
        >
          <img src="/BT.png" alt="BuscoTrabajo.co" className="block h-7 w-auto" />
        </Link>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Navegación principal">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={isActive(link.to) ? "page" : undefined}
              className={`flex h-11 items-center rounded-full px-4 text-[15px] font-semibold no-underline transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-1/60 ${
                isActive(link.to) ? "bg-green-soft text-primary" : "text-[#3d413e] hover:bg-[#f4f5f2] hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2.5">
          <CountrySwitcher country={country} pathname={location.pathname} variant="desktop" />
          {loading ? (
            // Avoid a flash of "logged out" while the session (incl. an OAuth
            // redirect hash) is still being resolved on first paint. The
            // signed-out buttons are laid out but invisible, so the nav
            // keeps its place when they appear (most visitors are signed
            // out, and the auth client now loads after the first render).
            <div aria-hidden="true" className="invisible flex items-center gap-2.5">
              <span className={ghostButton}>Iniciar sesión</span>
              <span className={ctaButton}>Ver vacantes</span>
            </div>
          ) : isAuthenticated ? (
            <Link to="/cuenta" className={`${ghostButton} max-w-[220px] truncate font-mono text-xs`}>
              {accountLabel}
            </Link>
          ) : (
            <>
              <Link to={loginHref} className={ghostButton}>
                Iniciar sesión
              </Link>
              <Link to={dashboardHref} className={ctaButton}>
                Ver vacantes
              </Link>
            </>
          )}
        </div>

        <button
          className="lg:hidden ink-card-sm flex h-11 w-11 items-center justify-center rounded-xl bg-white text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-1/60"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMobileNavOpen((prev) => !prev)}
        >
          {mobileNavOpen ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="3" x2="15" y2="15" />
              <line x1="15" y1="3" x2="3" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="2" y1="5" x2="16" y2="5" />
              <line x1="2" y1="9" x2="16" y2="9" />
              <line x1="2" y1="13" x2="16" y2="13" />
            </svg>
          )}
        </button>
      </div>

      {mobileNavOpen && (
        <div
          className="lg:hidden w-full border-t-2 border-foreground bg-white"
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
        >
          <nav className="flex flex-col gap-1.5 px-4 pt-4" aria-label="Navegación móvil">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={handleNavClick}
                aria-current={isActive(link.to) ? "page" : undefined}
                className={`flex min-h-[52px] items-center justify-between rounded-xl px-4 font-heading text-lg font-bold no-underline ${
                  isActive(link.to) ? "bg-green-soft text-primary" : "text-foreground hover:bg-[#f4f5f2]"
                }`}
              >
                {link.label}
                <span aria-hidden="true" className="text-muted-foreground">→</span>
              </Link>
            ))}
          </nav>
          <div className="px-4 pt-4">
            <CountrySwitcher country={country} pathname={location.pathname} variant="mobile" onNavigate={handleNavClick} />
          </div>
          <div className="flex flex-col gap-3 px-4 py-5">
            {loading ? null : isAuthenticated ? (
              <Link to="/cuenta" onClick={handleNavClick} className={`${ghostButton} h-12 font-mono`}>
                {accountLabel}
              </Link>
            ) : (
              <>
                <Link to={dashboardHref} onClick={handleNavClick} className={`${ctaButton} h-12 text-base`}>
                  Ver vacantes
                </Link>
                <Link to={loginHref} onClick={handleNavClick} className={`${ghostButton} h-12 text-base`}>
                  Iniciar sesión
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
