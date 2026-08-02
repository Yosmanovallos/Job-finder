import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Check } from "lucide-react";
import { hoverStyle } from "../lib/hover-style.js";
import { useAuth } from "../auth/auth-provider.js";
import { PAYWALL_ENABLED } from "../config.js";
import { Button } from "../components/ui/button.js";
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

const COUNTRY_FLAGS: Record<string, string> = { CO: "🇨🇴", VE: "🇻🇪" };
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

  const optionStyle = (code: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    fontSize: "0.875rem",
    color: code === country ? "#0e0f10" : "#5b5f5c",
    fontWeight: code === country ? 600 : 400,
    textDecoration: "none",
    background: code === country ? "#f1f2f0" : "transparent"
  });

  if (variant === "mobile") {
    return (
      <div className="flex items-center gap-2">
        {COUNTRY_ORDER.map((code) => (
          <Link
            key={code}
            to={getCountryTargetHref(pathname, code)}
            onClick={() => handleSelect(code)}
            style={{
              ...optionStyle(code),
              flex: 1,
              justifyContent: "center",
              border: `1px solid ${code === country ? "#0f6b4c" : "#e6e8e4"}`,
              minHeight: "44px"
            }}
          >
            <span style={{ fontSize: "1.1rem" }}>{COUNTRY_FLAGS[code]}</span>
            {COUNTRY_LABELS[code]}
            {code === country && <Check className="h-3.5 w-3.5" style={{ color: "#0f6b4c" }} />}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`País: ${COUNTRY_LABELS[country]}. Cambiar país`}
        className="flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "999px",
          border: "1px solid #e6e8e4",
          background: "#ffffff",
          minHeight: "44px",
          cursor: "pointer"
        }}
        {...hoverStyle<HTMLButtonElement>({ borderColor: "#d3d6cf" }, { borderColor: "#e6e8e4" })}
      >
        <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{COUNTRY_FLAGS[country]}</span>
        <span className="text-sm font-mono" style={{ color: "#5b5f5c" }}>
          {country}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5"
          style={{
            color: "#9a9d98",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease-out"
          }}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="flex flex-col gap-1"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: "168px",
            padding: "0.375rem",
            borderRadius: "10px",
            border: "1px solid #e6e8e4",
            background: "#ffffff",
            boxShadow: "0 8px 24px rgba(14,15,16,0.10)",
            zIndex: 60
          }}
        >
          {COUNTRY_ORDER.map((code) => (
            <Link
              key={code}
              to={getCountryTargetHref(pathname, code)}
              role="option"
              aria-selected={code === country}
              onClick={() => handleSelect(code)}
              style={optionStyle(code)}
              {...hoverStyle<HTMLAnchorElement>(
                { background: "#f1f2f0" },
                { background: code === country ? "#f1f2f0" : "transparent" }
              )}
            >
              <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{COUNTRY_FLAGS[code]}</span>
              {COUNTRY_LABELS[code]}
              {code === country && (
                <Check className="h-3.5 w-3.5 ml-auto" style={{ color: "#0f6b4c" }} />
              )}
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

  return (
    <header
      id="header"
      className="sticky top-0 z-50 w-full"
      style={{
        backgroundColor: "rgba(250,250,250, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #e6e8e4"
      }}
    >
      {/* Main nav bar */}
      <div
        className="mx-auto flex items-center justify-between px-4 md:px-8"
        style={{ maxWidth: "1200px", height: "64px" }}
      >
        {/* Brand */}
        <Link
          to={homeHref}
          className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded-sm"
          style={{
            color: "#0e0f10",
            ringColor: "#0f6b4c",
            ringOffsetColor: "#fafafa"
          }}
          aria-label="BuscoTrabajo — inicio"
        >
          <img
            src="/BT.png"
            alt="BuscoTrabajo.co"
            style={{ display: "block", height: "28px", width: "auto" }}
          />
        </Link>

        {/* Desktop center nav */}
        <nav className="hidden lg:flex items-center gap-1" aria-label="Navegación principal">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="relative px-4 py-2 rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                fontFamily:
                  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                fontSize: "0.9375rem",
                color: "#5b5f5c",
                textDecoration: "none",
                minHeight: "44px",
                display: "flex",
                alignItems: "center"
              }}
              {...hoverStyle<HTMLAnchorElement>({ color: "#0e0f10" }, { color: "#5b5f5c" })}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop right actions */}
        <div className="hidden lg:flex items-center gap-2">
          <CountrySwitcher country={country} pathname={location.pathname} variant="desktop" />
          {loading ? (
            // Avoid a flash of "logged out" while the session (incl. an OAuth
            // redirect hash) is still being resolved on first paint.
            <div className="w-24" style={{ height: "44px" }} />
          ) : isAuthenticated ? (
            <Button variant="outline" size="lg" className="font-mono text-xs" asChild>
              <Link to="/cuenta">{accountLabel}</Link>
            </Button>
          ) : (
            <>
              <Button variant="outline" size="lg" asChild>
                <Link to={loginHref}>Iniciar sesión</Link>
              </Button>
              <Button size="lg" asChild>
                <Link to={dashboardHref}>Probar gratis</Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden flex items-center justify-center rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            width: "44px",
            height: "44px",
            color: "#5b5f5c",
            backgroundColor: "transparent",
            border: "1px solid #e6e8e4",
            borderRadius: "8px"
          }}
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMobileNavOpen((prev) => !prev)}
          {...hoverStyle<HTMLButtonElement>(
            { color: "#0e0f10", borderColor: "#d3d6cf" },
            { color: "#5b5f5c", borderColor: "#e6e8e4" }
          )}
        >
          {mobileNavOpen ? (
            /* X icon */
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="3" x2="15" y2="15" />
              <line x1="15" y1="3" x2="3" y2="15" />
            </svg>
          ) : (
            /* Hamburger icon */
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="2" y1="5" x2="16" y2="5" />
              <line x1="2" y1="9" x2="16" y2="9" />
              <line x1="2" y1="13" x2="16" y2="13" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown panel */}
      {mobileNavOpen && (
        <div
          className="lg:hidden w-full"
          style={{
            backgroundColor: "#ffffff",
            borderTop: "1px solid #e6e8e4",
            borderBottom: "1px solid #e6e8e4"
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
        >
          {/* Mono system label */}
          <div
            className="px-4 pt-4 pb-2"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: "0.6875rem",
              color: "#9a9d98",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              borderBottom: "1px solid #e6e8e4"
            }}
          >
            — navegación
          </div>

          <nav className="flex flex-col px-4 py-3 gap-1" aria-label="Navegación móvil">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={handleNavClick}
                className="flex items-center rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                  fontSize: "1rem",
                  color: "#5b5f5c",
                  textDecoration: "none",
                  minHeight: "48px",
                  padding: "0 8px"
                }}
                {...hoverStyle<HTMLAnchorElement>(
                  { color: "#0e0f10", backgroundColor: "#f1f2f0" },
                  { color: "#5b5f5c", backgroundColor: "transparent" }
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="px-2 pt-2">
              <CountrySwitcher
                country={country}
                pathname={location.pathname}
                variant="mobile"
                onNavigate={handleNavClick}
              />
            </div>
          </nav>

          {/* Divider */}
          <div style={{ borderTop: "1px solid #e6e8e4", margin: "0 16px" }} />

          {/* Mobile actions */}
          <div className="flex flex-col gap-3 px-4 py-4">
            {loading ? null : isAuthenticated ? (
              <Button variant="outline" size="lg" className="font-mono text-sm" asChild>
                <Link to="/cuenta" onClick={handleNavClick}>
                  {accountLabel}
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="outline" size="lg" className="text-base" asChild>
                  <Link to={loginHref} onClick={handleNavClick}>
                    Iniciar sesión
                  </Link>
                </Button>
                <Button size="lg" className="text-base" asChild>
                  <Link to={dashboardHref} onClick={handleNavClick}>
                    Probar gratis
                  </Link>
                </Button>
              </>
            )}
          </div>

          {/* Bottom mono system line */}
          <div
            className="px-4 py-2"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: "0.6875rem",
              color: "#9a9d98",
              letterSpacing: "0.08em",
              borderTop: "1px solid #e6e8e4"
            }}
          >
            sys://buscotrabajo/nav · v1.0
          </div>
        </div>
      )}
    </header>
  );
}
