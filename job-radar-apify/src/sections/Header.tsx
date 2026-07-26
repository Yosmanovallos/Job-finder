import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { hoverStyle } from "../lib/hover-style.js";
import { useAuth } from "../auth/auth-provider.js";
import { PAYWALL_ENABLED } from "../config.js";

const navLinks = [
  { label: "Cómo funciona", to: "/como-funciona" },
  { label: "Fuentes", to: "/fuentes" },
  ...(PAYWALL_ENABLED ? [{ label: "Precios", to: "/pricing" }] : []),
  { label: "Preguntas", to: "/preguntas" }
];

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
          to="/"
          className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded-sm"
          style={{
            color: "#0e0f10",
            ringColor: "#0f6b4c",
            ringOffsetColor: "#fafafa"
          }}
          aria-label="BuscoTrabajo — inicio"
        >
          {/* Radar SVG icon */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0f6b4c"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="2" fill="#0f6b4c" stroke="none" />
            <circle cx="12" cy="12" r="5.5" />
            <circle cx="12" cy="12" r="9.5" />
            <line x1="12" y1="12" x2="19" y2="5" strokeWidth="1.5" />
          </svg>
          <span
            className="font-semibold tracking-tight"
            style={{
              fontFamily:
                'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
              fontSize: "1rem",
              color: "#0e0f10",
              letterSpacing: "-0.01em"
            }}
          >
            BuscoTrabajo<span style={{ color: "#c99a2e" }}>.co</span>
          </span>
          {/* Mono micro-label — desktop only */}
          <span
            className="hidden lg:inline-block"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: "0.6875rem",
              color: "#9a9d98",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginLeft: "4px",
              paddingTop: "2px"
            }}
          >
            v1.0
          </span>
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
          {loading ? (
            // Avoid a flash of "logged out" while the session (incl. an OAuth
            // redirect hash) is still being resolved on first paint.
            <div className="w-24" style={{ height: "44px" }} />
          ) : isAuthenticated ? (
            <Link
              to="/cuenta"
              className="px-4 py-2 rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 font-mono text-xs"
              style={{
                color: "#0e0f10",
                border: "1px solid #e6e8e4",
                borderRadius: "8px",
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                textDecoration: "none",
                backgroundColor: "transparent"
              }}
              {...hoverStyle<HTMLAnchorElement>(
                { borderColor: "#d3d6cf", backgroundColor: "#ffffff" },
                { borderColor: "#e6e8e4", backgroundColor: "transparent" }
              )}
            >
              {accountLabel}
            </Link>
          ) : (
            <>
              <Link
                to={loginHref}
                className="px-4 py-2 rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                  fontSize: "0.9375rem",
                  color: "#5b5f5c",
                  border: "1px solid #e6e8e4",
                  borderRadius: "8px",
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                  textDecoration: "none",
                  backgroundColor: "transparent"
                }}
                {...hoverStyle<HTMLAnchorElement>(
                  { color: "#0e0f10", borderColor: "#d3d6cf", backgroundColor: "#ffffff" },
                  { color: "#5b5f5c", borderColor: "#e6e8e4", backgroundColor: "transparent" }
                )}
              >
                Iniciar sesión
              </Link>
              <Link
                to="/dashboard"
                className="px-5 py-2 font-semibold rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                  fontSize: "0.9375rem",
                  color: "#fafafa",
                  backgroundColor: "#0f6b4c",
                  borderRadius: "8px",
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                  textDecoration: "none",
                  fontWeight: 600
                }}
                {...hoverStyle<HTMLAnchorElement>(
                  { backgroundColor: "#14805a" },
                  { backgroundColor: "#0f6b4c" }
                )}
              >
                Probar gratis
              </Link>
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
          </nav>

          {/* Divider */}
          <div style={{ borderTop: "1px solid #e6e8e4", margin: "0 16px" }} />

          {/* Mobile actions */}
          <div className="flex flex-col gap-3 px-4 py-4">
            {loading ? null : isAuthenticated ? (
              <Link
                to="/cuenta"
                onClick={handleNavClick}
                className="flex items-center justify-center rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 font-mono text-sm"
                style={{
                  color: "#0e0f10",
                  border: "1px solid #e6e8e4",
                  borderRadius: "8px",
                  minHeight: "48px",
                  textDecoration: "none",
                  backgroundColor: "transparent"
                }}
                {...hoverStyle<HTMLAnchorElement>(
                  { borderColor: "#d3d6cf", backgroundColor: "#f1f2f0" },
                  { borderColor: "#e6e8e4", backgroundColor: "transparent" }
                )}
              >
                {accountLabel}
              </Link>
            ) : (
              <>
                <Link
                  to={loginHref}
                  onClick={handleNavClick}
                  className="flex items-center justify-center rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    fontFamily:
                      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                    fontSize: "1rem",
                    color: "#5b5f5c",
                    border: "1px solid #e6e8e4",
                    borderRadius: "8px",
                    minHeight: "48px",
                    textDecoration: "none",
                    backgroundColor: "transparent"
                  }}
                  {...hoverStyle<HTMLAnchorElement>(
                    { color: "#0e0f10", borderColor: "#d3d6cf", backgroundColor: "#f1f2f0" },
                    { color: "#5b5f5c", borderColor: "#e6e8e4", backgroundColor: "transparent" }
                  )}
                >
                  Iniciar sesión
                </Link>
                <Link
                  to="/dashboard"
                  onClick={handleNavClick}
                  className="flex items-center justify-center font-semibold rounded-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    fontFamily:
                      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                    fontSize: "1rem",
                    color: "#fafafa",
                    backgroundColor: "#0f6b4c",
                    borderRadius: "8px",
                    minHeight: "48px",
                    textDecoration: "none",
                    fontWeight: 600
                  }}
                  {...hoverStyle<HTMLAnchorElement>(
                    { backgroundColor: "#14805a" },
                    { backgroundColor: "#0f6b4c" }
                  )}
                >
                  Probar gratis
                </Link>
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
