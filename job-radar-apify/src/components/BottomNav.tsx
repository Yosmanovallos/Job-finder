import { Link, useLocation } from "react-router-dom";
import { getEffectiveCountry } from "../lib/country-context.js";

// Phone-only bottom bar, on every page (rendered once in App.tsx). Footer.tsx
// adds the matching bottom padding so the bar never covers its last row.
export default function BottomNav() {
  const { pathname } = useLocation();
  const prefix = getEffectiveCountry(pathname) === "VE" ? "/ve" : "";
  const path = pathname.replace(/^\/ve(?=\/|$)/, "") || "/";
  const active = {
    home: path === "/",
    search: path.startsWith("/dashboard") || path.startsWith("/empleos/"),
    companies: path.startsWith("/empresas"),
    saved: path.startsWith("/cuenta")
  };
  const item = (on: boolean) =>
    `text-[13px] flex flex-col items-center justify-center gap-0.5 font-bold no-underline ${on ? "text-primary" : "text-[#3d413e]"}`;
  return (
    <nav aria-label="Navegación inferior" className="md:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 h-16 border-t-2 border-foreground bg-white pb-[env(safe-area-inset-bottom)]">
      <Link to={prefix || "/"} aria-current={active.home ? "page" : undefined} className={item(active.home)}>
        <svg aria-hidden="true" className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7v9H3z" /></svg>
        Inicio
      </Link>
      <Link to={`${prefix}/dashboard`} aria-current={active.search ? "page" : undefined} className={item(active.search)}>
        <span className="w-11 h-[30px] rounded-[10px] border-2 border-foreground bg-gold-2 grid place-items-center text-foreground">
          <svg aria-hidden="true" className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </span>
        Buscar
      </Link>
      <Link to={`${prefix}/empresas`} aria-current={active.companies ? "page" : undefined} className={item(active.companies)}>
        <svg aria-hidden="true" className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4" /></svg>
        Empresas
      </Link>
      <Link to="/cuenta#guardadas" aria-current={active.saved ? "page" : undefined} className={item(active.saved)}>
        <svg aria-hidden="true" className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
        Guardadas
      </Link>
    </nav>
  );
}
