import { Link } from "react-router-dom";
import { hoverStyle } from "../lib/hover-style.js";

// Navigation data
const navLinks = [
  { label: "Cómo funciona", href: "/como-funciona" },
  { label: "Fuentes", href: "/fuentes" },
  { label: "Precios", href: "/pricing" },
  { label: "Preguntas", href: "/preguntas" }
];

const productLinks = [
  { label: "Búsqueda inteligente", href: "/#hero-demo" },
  { label: "Deduplicación", href: "/#product-features-pricing-faq" },
  { label: "Verificación de vigencia", href: "/#product-features-pricing-faq" },
  { label: "Paywall de frescura 48h", href: "/#product-features-pricing-faq" },
  { label: "Guardar y marcar aplicadas", href: "/#product-features-pricing-faq" }
];

const resourceLinks = [
  { label: "Preguntas frecuentes", href: "/preguntas" },
  { label: "Cómo funciona", href: "/como-funciona" },
  { label: "Fuentes de datos", href: "/fuentes" },
  { label: "Guía de inicio rápido", href: "/#hero-demo" }
];

const legalLinks = [
  { label: "Términos de uso", href: "/legal/terminos" },
  { label: "Política de privacidad", href: "/legal/privacidad" },
  { label: "Uso aceptable", href: "/legal/uso-aceptable" },
  { label: "Cookies", href: "/legal/cookies" }
];

const contactLinks = [{ label: "hola@jobradar.co", href: "mailto:hola@jobradar.co" }];

export default function Footer() {
  return (
    <footer
      id="footer"
      className="bg-muted border-t border-border"
      style={{
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
      }}
    >
      {/* Final CTA Block */}
      <div className="w-full border-b border-border" style={{ backgroundColor: "#0A0B0D" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 py-20 flex flex-col items-center text-center">
          {/* Mono eyebrow */}
          <span
            className="text-xs uppercase tracking-widest mb-6 block"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              color: "#34D399"
            }}
          >
            // siguiente paso
          </span>

          <h2
            className="font-heading font-semibold mb-4 leading-tight tracking-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              color: "#F4F5F7",
              letterSpacing: "-0.01em"
            }}
          >
            Tu próxima vacante ya se publicó
          </h2>

          <p
            className="mb-8 max-w-md"
            style={{
              fontSize: "0.9375rem",
              lineHeight: "1.65",
              color: "#9AA1AC"
            }}
          >
            Empieza gratis hoy. Sin tarjeta de crédito, sin compromisos. Encuentra antes que los
            demás.
          </p>

          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center px-8 py-3 rounded-sm font-semibold text-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              backgroundColor: "#34D399",
              color: "#0A0B0D",
              minHeight: "44px",
              borderRadius: "8px",
              // @ts-ignore
              "--tw-ring-color": "#34D399",
              "--tw-ring-offset-color": "#0A0B0D"
            }}
            {...hoverStyle<HTMLAnchorElement>(
              { backgroundColor: "#6EE7B7" },
              { backgroundColor: "#34D399" }
            )}
          >
            Probar gratis
          </Link>
        </div>
      </div>

      {/* Grid separator with mono label */}
      <div className="w-full" style={{ backgroundColor: "#131519" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16">
          {/* Retícula line with mono label */}
          <div className="flex items-center gap-4 py-4 border-b border-border">
            <span
              className="text-xs shrink-0"
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                color: "#646B75"
              }}
            >
              // footer.nav
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: "#262A31" }} />
          </div>

          {/* 4-column footer grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 py-12">
            {/* Column 1: Producto */}
            <div>
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="text-xs uppercase tracking-widest"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: "#646B75"
                  }}
                >
                  Producto
                </span>
              </div>
              <ul className="space-y-3">
                {productLinks.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.href}
                      className="text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519"
                      }}
                      {...hoverStyle<HTMLAnchorElement>({ color: "#F4F5F7" }, { color: "#9AA1AC" })}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 2: Recursos */}
            <div>
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="text-xs uppercase tracking-widest"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: "#646B75"
                  }}
                >
                  Recursos
                </span>
              </div>
              <ul className="space-y-3">
                {resourceLinks.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.href}
                      className="transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519"
                      }}
                      {...hoverStyle<HTMLAnchorElement>({ color: "#F4F5F7" }, { color: "#9AA1AC" })}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 3: Legal */}
            <div>
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="text-xs uppercase tracking-widest"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: "#646B75"
                  }}
                >
                  Legal
                </span>
              </div>
              <ul className="space-y-3">
                {legalLinks.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.href}
                      className="transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519"
                      }}
                      {...hoverStyle<HTMLAnchorElement>({ color: "#F4F5F7" }, { color: "#9AA1AC" })}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 4: Contacto */}
            <div>
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="text-xs uppercase tracking-widest"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: "#646B75"
                  }}
                >
                  Contacto
                </span>
              </div>
              <ul className="space-y-3 mb-6">
                {contactLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        fontFamily: link.label.includes("@")
                          ? 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
                          : "inherit",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519"
                      }}
                      {...hoverStyle<HTMLAnchorElement>({ color: "#F4F5F7" }, { color: "#9AA1AC" })}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div
            className="border-t py-6 flex flex-col sm:flex-row items-center justify-between gap-4"
            style={{ borderColor: "#262A31" }}
          >
            {/* Wordmark */}
            <div className="flex items-center gap-2">
              {/* Radar SVG icon */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="9" stroke="#34D399" strokeWidth={1} opacity={0.3} />
                <circle cx="10" cy="10" r="6" stroke="#34D399" strokeWidth={1} opacity={0.5} />
                <circle cx="10" cy="10" r="3" stroke="#34D399" strokeWidth={1} opacity={0.8} />
                <circle cx="10" cy="10" r="1.5" fill="#34D399" />
              </svg>
              <span className="font-semibold text-sm" style={{ color: "#F4F5F7" }}>
                Job Radar
              </span>
            </div>

            {/* Copyright */}
            <p
              className="text-xs text-center"
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                color: "#646B75"
              }}
            >
              © 2026 Job Radar. Hecho en Medellín, Colombia.
            </p>

            {/* Nav links */}
            <nav className="flex items-center gap-4 flex-wrap justify-center">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  className="text-xs transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                  style={{
                    color: "#646B75",
                    // @ts-ignore
                    "--tw-ring-color": "#34D399",
                    "--tw-ring-offset-color": "#131519"
                  }}
                  {...hoverStyle<HTMLAnchorElement>({ color: "#9AA1AC" }, { color: "#646B75" })}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
