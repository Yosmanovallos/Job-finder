import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "../lib/agent-readiness.js";

// Site-wide footer in the homepage's ink style (design canvas R3,
// 2026-10-25). The old "Probar gratis / sin tarjeta" CTA block is gone:
// BuscoTrabajo is free, so that copy no longer described anything real.

interface FooterLink {
  label: string;
  href: string;
  icon: ReactNode;
}

const iconProps = {
  "aria-hidden": true,
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

const resourceLinks: FooterLink[] = [
  { label: "Cómo funciona", href: "/como-funciona", icon: <svg {...iconProps} stroke="#9c7518"><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4z" /></svg> },
  { label: "Fuentes de datos", href: "/fuentes", icon: <svg {...iconProps} stroke="#9c7518"><path d="M4 6h16M4 12h16M4 18h10" /></svg> },
  { label: "Empresas", href: "/empresas", icon: <svg {...iconProps} stroke="#9c7518"><path d="M3 21h18M5 21V7l7-4 7 4v14" /></svg> },
  { label: "API y agentes", href: "/docs", icon: <svg {...iconProps} stroke="#9c7518"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3" /></svg> },
  { label: "Acerca de", href: "/about", icon: <svg {...iconProps} stroke="#9c7518"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg> }
];

const legalLinks: FooterLink[] = [
  { label: "Términos de uso", href: "/legal/terminos", icon: <svg {...iconProps} stroke="#0a4f96"><path d="M6 3h9l3 3v15H6z" /><path d="M9 11h6M9 15h6" /></svg> },
  { label: "Política de privacidad", href: "/legal/privacidad", icon: <svg {...iconProps} stroke="#0a4f96"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg> },
  { label: "Uso aceptable", href: "/legal/uso-aceptable", icon: <svg {...iconProps} stroke="#0a4f96"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg> },
  { label: "Cookies", href: "/legal/cookies", icon: <svg {...iconProps} stroke="#0a4f96"><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r="1" /><circle cx="14" cy="14" r="1" /></svg> }
];

// Official accounts (confirmed by the owner, 2026-10-25).
const socialLinks = [
  {
    label: "BuscoTrabajo en Instagram",
    href: "https://www.instagram.com/buscotrabajocolombia.co/",
    bg: "bg-[#fde8dc]",
    icon: (
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    )
  },
  {
    label: "BuscoTrabajo en TikTok",
    href: "https://www.tiktok.com/@busco.trabajo09",
    bg: "bg-[#fdf1d3]",
    icon: (
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.6 2h-3.4v13.3a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.4 6.3V8.6a7.9 7.9 0 0 0 4.4 1.4V6.6a4.5 4.5 0 0 1-4.4-4.6z" />
      </svg>
    )
  },
  {
    label: "BuscoTrabajo en X",
    href: "https://x.com/Buscotrabajoco",
    bg: "bg-white",
    icon: (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" />
      </svg>
    )
  },
  {
    label: "BuscoTrabajo en YouTube",
    href: "https://www.youtube.com/@buscotrabajo-d5n",
    bg: "bg-green-soft",
    icon: (
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15.1V8.9l5.2 3.1z" />
      </svg>
    )
  }
];

function LinkColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <nav aria-label={title} className="flex flex-col gap-0.5 md:gap-2.5">
      <strong className="font-mono text-[11px] md:text-xs font-bold tracking-[0.1em] py-1.5 md:py-0">{title.toUpperCase()}</strong>
      {links.map((link) => (
        <Link key={link.href} to={link.href} className="flex items-center gap-2 py-2 md:py-0 text-sm text-[#3d413e] hover:text-foreground">
          <span className="hidden md:inline-flex">{link.icon}</span>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export default function Footer() {
  return (
    // pb-16: room for the fixed phone bottom bar (BottomNav.tsx), on every page.
    <footer id="footer" className="border-t-2 border-foreground bg-[#fbfaf6] pb-16 md:pb-0">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-[22px] md:pt-14 pb-6 md:pb-8 grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4 md:gap-8">
        <div className="col-span-2 md:col-span-1">
          <img src="/BT.png" alt="Buscotrabajo.co" className="h-[18px] md:h-[22px] w-auto" />
          <p className="hidden md:block mt-3.5 mb-[18px] text-sm leading-relaxed text-[#3d413e]">
            Todas las ofertas de empleo de Colombia en un solo lugar. Gratis.
          </p>
          <div className="mt-4 md:mt-0 grid grid-cols-4 md:flex gap-2 md:gap-2.5">
            {socialLinks.map((social) => (
              <a
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className={`ink-card-sm ink-lift h-12 md:w-11 md:h-11 rounded-xl grid place-items-center text-foreground ${social.bg}`}
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
        <LinkColumn title="Recursos" links={resourceLinks} />
        <LinkColumn title="Legal" links={legalLinks} />
        <div className="col-span-2 md:col-span-1 flex flex-col gap-2.5">
          <strong className="hidden md:block font-mono text-xs font-bold tracking-[0.1em]">CONTACTO</strong>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[13px] md:text-sm text-[#3d413e] break-all">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-4 pb-7 border-t-2 border-foreground flex flex-wrap justify-between gap-3 text-xs md:text-[13px] text-muted-foreground">
        <span>© 2026 Buscotrabajo.co</span>
        <span>Las marcas de los portales indican la procedencia de cada vacante; no implican alianza ni patrocinio.</span>
      </div>
    </footer>
  );
}
