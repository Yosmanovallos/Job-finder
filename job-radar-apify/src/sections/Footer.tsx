import { useState } from "react";

// Navigation data
const navLinks = [
  { label: "Cómo funciona", href: "#como-funciona" },
  { label: "Fuentes", href: "#fuentes" },
  { label: "Precios", href: "#precios" },
  { label: "Preguntas", href: "#preguntas" },
];

const productLinks = [
  { label: "Búsqueda inteligente", href: "#hero-demo" },
  { label: "Deduplicación", href: "#product-features-pricing-faq" },
  { label: "Verificación de vigencia", href: "#product-features-pricing-faq" },
  { label: "Sincronización Notion", href: "#product-features-pricing-faq" },
  { label: "Búsquedas guardadas", href: "#product-features-pricing-faq" },
];

const resourceLinks = [
  { label: "Preguntas frecuentes", href: "#preguntas" },
  { label: "Cómo funciona", href: "#como-funciona" },
  { label: "Fuentes de datos", href: "#fuentes" },
  { label: "Guía de inicio rápido", href: "#hero-demo" },
];

const legalLinks = [
  { label: "Términos de uso", href: "#top" },
  { label: "Política de privacidad", href: "#top" },
  { label: "Uso aceptable", href: "#top" },
  { label: "Cookies", href: "#top" },
];

const contactLinks = [
  { label: "hola@jobradar.co", href: "mailto:hola@jobradar.co" },
  { label: "Twitter / X", href: "#top" },
  { label: "LinkedIn", href: "#top" },
];

export default function Footer() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleNewsletter = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
    }
  };

  return (
    <footer
      id="footer"
      className="bg-muted border-t border-border"
      style={{
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* Final CTA Block */}
      <div
        className="w-full border-b border-border"
        style={{ backgroundColor: "#0A0B0D" }}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 py-20 flex flex-col items-center text-center">
          {/* Mono eyebrow */}
          <span
            className="text-xs uppercase tracking-widest mb-6 block"
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              color: "#34D399",
            }}
          >
            // siguiente paso
          </span>

          <h2
            className="font-heading font-semibold mb-4 leading-tight tracking-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              color: "#F4F5F7",
              letterSpacing: "-0.01em",
            }}
          >
            Tu próxima vacante ya se publicó
          </h2>

          <p
            className="mb-8 max-w-md"
            style={{
              fontSize: "0.9375rem",
              lineHeight: "1.65",
              color: "#9AA1AC",
            }}
          >
            Empieza gratis hoy. Sin tarjeta de crédito, sin compromisos.
            Encuentra antes que los demás.
          </p>

          <a
            href="#hero-demo"
            className="inline-flex items-center justify-center px-8 py-3 rounded-sm font-semibold text-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              backgroundColor: "#34D399",
              color: "#0A0B0D",
              minHeight: "44px",
              borderRadius: "8px",
              // @ts-ignore
              "--tw-ring-color": "#34D399",
              "--tw-ring-offset-color": "#0A0B0D",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
                "#6EE7B7";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
                "#34D399";
            }}
          >
            Probar gratis
          </a>
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
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                color: "#646B75",
              }}
            >
              // footer.nav
            </span>
            <div
              className="flex-1 h-px"
              style={{ backgroundColor: "#262A31" }}
            />
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
                    color: "#646B75",
                  }}
                >
                  Producto
                </span>
              </div>
              <ul className="space-y-3">
                {productLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#F4F5F7";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#9AA1AC";
                      }}
                    >
                      {link.label}
                    </a>
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
                    color: "#646B75",
                  }}
                >
                  Recursos
                </span>
              </div>
              <ul className="space-y-3">
                {resourceLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#F4F5F7";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#9AA1AC";
                      }}
                    >
                      {link.label}
                    </a>
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
                    color: "#646B75",
                  }}
                >
                  Legal
                </span>
              </div>
              <ul className="space-y-3">
                {legalLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                      style={{
                        color: "#9AA1AC",
                        fontSize: "0.9375rem",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#F4F5F7";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#9AA1AC";
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 4: Contacto + Newsletter */}
            <div>
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="text-xs uppercase tracking-widest"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: "#646B75",
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
                        "--tw-ring-offset-color": "#131519",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#F4F5F7";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color =
                          "#9AA1AC";
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>

              {/* Newsletter */}
              <div>
                <p
                  className="text-xs mb-3"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    color: "#646B75",
                  }}
                >
                  // alertas de novedades
                </p>
                {submitted ? (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-sm border"
                    style={{
                      borderColor: "#34D399",
                      backgroundColor: "rgba(52,211,153,0.10)",
                      borderRadius: "8px",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="#34D399"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="2 7 5.5 10.5 12 3.5" />
                    </svg>
                    <span
                      className="text-xs"
                      style={{
                        color: "#34D399",
                        fontFamily:
                          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                      }}
                    >
                      ¡Listo! Te avisamos.
                    </span>
                  </div>
                ) : (
                  <form
                    onSubmit={handleNewsletter}
                    className="flex flex-col gap-2"
                  >
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      className="w-full px-3 py-2 text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                      style={{
                        backgroundColor: "#1B1E24",
                        border: "1px solid #262A31",
                        borderRadius: "8px",
                        color: "#F4F5F7",
                        fontSize: "0.875rem",
                        minHeight: "44px",
                        fontFamily:
                          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519",
                      }}
                      onFocus={(e) => {
                        (
                          e.currentTarget as HTMLInputElement
                        ).style.borderColor = "#34D399";
                      }}
                      onBlur={(e) => {
                        (
                          e.currentTarget as HTMLInputElement
                        ).style.borderColor = "#262A31";
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!email.trim()}
                      className="w-full px-4 py-2 text-sm font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none"
                      style={{
                        backgroundColor: "#34D399",
                        color: "#0A0B0D",
                        borderRadius: "8px",
                        minHeight: "44px",
                        // @ts-ignore
                        "--tw-ring-color": "#34D399",
                        "--tw-ring-offset-color": "#131519",
                      }}
                      onMouseEnter={(e) => {
                        if (!e.currentTarget.disabled)
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.backgroundColor = "#6EE7B7";
                      }}
                      onMouseLeave={(e) => {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.backgroundColor = "#34D399";
                      }}
                    >
                      Suscribirme
                    </button>
                  </form>
                )}
              </div>
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
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="10"
                  cy="10"
                  r="9"
                  stroke="#34D399"
                  strokeWidth={1}
                  opacity={0.3}
                />
                <circle
                  cx="10"
                  cy="10"
                  r="6"
                  stroke="#34D399"
                  strokeWidth={1}
                  opacity={0.5}
                />
                <circle
                  cx="10"
                  cy="10"
                  r="3"
                  stroke="#34D399"
                  strokeWidth={1}
                  opacity={0.8}
                />
                <circle cx="10" cy="10" r="1.5" fill="#34D399" />
              </svg>
              <span
                className="font-semibold text-sm"
                style={{ color: "#F4F5F7" }}
              >
                Job Radar
              </span>
            </div>

            {/* Copyright */}
            <p
              className="text-xs text-center"
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                color: "#646B75",
              }}
            >
              © 2026 Job Radar. Hecho en Medellín, Colombia.
            </p>

            {/* Nav links */}
            <nav className="flex items-center gap-4 flex-wrap justify-center">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-xs transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-sm"
                  style={{
                    color: "#646B75",
                    // @ts-ignore
                    "--tw-ring-color": "#34D399",
                    "--tw-ring-offset-color": "#131519",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "#9AA1AC";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "#646B75";
                  }}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
