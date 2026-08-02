// Shared source of truth for "which country is the visitor currently in,"
// on top of the existing pathname-prefix pattern (no route param — see
// Dashboard.tsx's original comment). Two things this adds on top of pure
// pathname detection:
//
// 1. Persistence: the choice survives navigating to a page that has no
//    "/ve" variant of its own (the logo link, footer links, any hardcoded
//    "/dashboard" CTA scattered across the site) instead of silently
//    reverting to Colombia.
// 2. A single list of which unprefixed paths actually have country-specific
//    data (COUNTRY_SCOPED_UNPREFIXED) so App.tsx's redirect gate and
//    Header.tsx's switcher agree on the same set instead of drifting.
const STORAGE_KEY = "bt_country";

export function getStoredCountry(): string | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "VE" || v === "CO" ? v : null;
  } catch {
    // Private-browsing / storage-disabled: fall through to pathname-only
    // detection everywhere else, same as if nothing had ever been chosen.
    return null;
  }
}

export function setStoredCountry(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Nothing to do — see getStoredCountry.
  }
}

// Pages that show different data per country but share ONE path for
// Colombia (default) — Venezuela's equivalent lives at the "/ve" prefix.
// Job detail pages (/empleos/:id) are deliberately excluded: they stay
// country-agnostic everywhere (see job-seo.ts's buildJobPath), so a redirect
// here would fight the sitemap/Indexing API pipeline, which only ever knows
// about the unprefixed URL.
const COUNTRY_SCOPED_UNPREFIXED = [/^\/$/, /^\/dashboard$/, /^\/empresas$/, /^\/empresas\//];

export function isCountryScopedUnprefixed(pathname: string): boolean {
  return COUNTRY_SCOPED_UNPREFIXED.some((re) => re.test(pathname));
}

export function isVePrefixed(pathname: string): boolean {
  return pathname === "/ve" || pathname.startsWith("/ve/");
}

// "/ve"-prefixed pages are unambiguous. Unprefixed-but-scoped pages
// (/, /dashboard, /empresas...) are always redirected away from here before
// they'd need to ask (see AppRoutes in App.tsx) — CO is a safe fallback for
// the one render tick before that redirect fires. Everything else
// (informational/auth/legal pages, which render identical content
// regardless of country) falls back to whatever the visitor last chose via
// the switcher, defaulting to Colombia.
export function getEffectiveCountry(pathname: string): string {
  if (isVePrefixed(pathname)) return "VE";
  if (isCountryScopedUnprefixed(pathname)) return "CO";
  return getStoredCountry() || "CO";
}
