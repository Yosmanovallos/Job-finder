import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Shared frame for the content pages (/como-funciona, /fuentes, /preguntas,
// /docs, /about, /contact, /privacy, /legal/*), in the homepage's approved
// style: green-soft hero, ink outline + hard offset shadow, tinted cards and
// a gold call to action. Pages pass their own copy; the H1 text must stay the
// exact string server.ts injects into the raw HTML for that route.

export function PageHero({
  eyebrow,
  heading,
  children,
  aside
}: {
  eyebrow: string;
  heading: string;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  // First <section> of the page: .scroll-reveal never animates it, so the
  // H1 (usually the LCP element) is visible on the first frame.
  return (
    <section className="bg-gradient-to-b from-green-soft to-white">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-8 pb-10 md:pt-16 md:pb-20 flex flex-wrap items-center gap-8 md:gap-12">
        <div className="flex-[1_1_520px] min-w-0">
          <p className="ink-card-sm inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] pl-2 pr-3 py-1 mb-4 md:mb-5 font-mono text-xs md:text-[13px] font-semibold tracking-wider uppercase shadow-none">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-primary" />
            {eyebrow}
          </p>
          <h1 className="font-heading font-bold tracking-[-0.04em] leading-[1.05] text-[32px] md:text-[clamp(40px,5vw,62px)] max-w-[900px]">
            {heading}
          </h1>
          {children ? <div className="mt-4 md:mt-6 max-w-[720px] text-[15px] md:text-[19px] leading-relaxed text-[#3d413e] space-y-3">{children}</div> : null}
        </div>
        {aside ? <div className="flex-[1_1_380px] min-w-0">{aside}</div> : null}
      </div>
    </section>
  );
}

// Plain content band below the hero. sr-host: its cards reveal one by one
// instead of the whole section fading in as a block.
export function ContentSection({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 py-8 md:py-14 ${className}`}>{children}</section>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="sr font-heading font-bold text-[24px] md:text-[40px] leading-tight tracking-[-0.03em] mb-4 md:mb-8">{children}</h2>
  );
}

export function InkPanel({
  children,
  tint = "#ffffff",
  className = ""
}: {
  children: ReactNode;
  tint?: string;
  className?: string;
}) {
  return (
    <div className={`sr ink-card-sm md:ink-card rounded-2xl md:rounded-3xl p-5 md:p-8 ${className}`} style={{ backgroundColor: tint }}>
      {children}
    </div>
  );
}

// Same closing band as the homepage, pointing to the vacancies.
export function ContentCta({ heading = "La vacante que buscas ya se publicó" }: { heading?: string }) {
  return (
    <section className="sr-host px-4 md:px-6 pt-4 pb-10 md:pb-24">
      <div className="sr relative overflow-hidden max-w-[1240px] mx-auto rounded-[20px] md:rounded-[32px] bg-green-deep text-white text-center px-5 py-8 md:px-10 md:py-16">
        <div aria-hidden="true" className="absolute -left-28 -top-48 w-[520px] h-[520px] rounded-full bg-[radial-gradient(circle,rgba(212,165,55,0.55),rgba(212,165,55,0)_65%)]" />
        <div aria-hidden="true" className="absolute -right-28 -bottom-64 w-[520px] h-[520px] rounded-full bg-[radial-gradient(circle,rgba(31,163,122,0.6),rgba(31,163,122,0)_65%)]" />
        <h2 className="relative font-heading font-bold text-2xl md:text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.03em]">{heading}</h2>
        <Link
          to="/dashboard"
          className="relative mt-5 md:mt-7 flex md:inline-flex h-[52px] md:h-[58px] items-center justify-center rounded-xl md:rounded-[14px] border-2 border-foreground bg-gold-2 px-[30px] font-bold text-[#2a1d06] no-underline"
        >
          Ver vacantes de hoy →
        </Link>
      </div>
    </section>
  );
}

// Internal link or mailto, styled as a pill.
export function PillLink({ href, children }: { href: string; children: ReactNode }) {
  const className =
    "ink-card-sm ink-lift inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-foreground no-underline";
  if (href.startsWith("/") && !href.startsWith("//") && !/\.(txt|json|xml|md)$/.test(href)) {
    return (
      <Link to={href} className={className}>
        {children} <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}
