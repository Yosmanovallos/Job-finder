import { Link, useLocation } from "react-router-dom";
import type { FeedbackLinkState } from "../lib/site-feedback.js";

// Quick way into /opiniones from any public page (rendered once in App.tsx,
// like BottomNav). position: fixed, so it never moves the layout (no CLS),
// and it is a plain link: no fetch, no state, nothing added to first paint.
// Phones: a compact pill above the 64px BottomNav and the safe area.
// Hidden where it would be in the way or makes no sense.
const HIDDEN = /^\/(opiniones|login|reset-password|auth\/callback|cuenta|pricing|checkout)(\/|$)/;

export default function FeedbackButton() {
  const { pathname } = useLocation();
  if (HIDDEN.test(pathname)) return null;
  const state: FeedbackLinkState = { feedback: { kind: "opinion" } };
  return (
    <Link
      to="/opiniones"
      state={state}
      aria-label="Danos tu opinión sobre BuscoTrabajo"
      className="ink-card-sm ink-lift fixed z-30 right-3 md:right-6 bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6 inline-flex items-center gap-2 h-11 rounded-full bg-white px-4 text-sm font-bold text-foreground no-underline"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
      </svg>
      <span className="md:hidden">Opinar</span>
      <span className="hidden md:inline">Danos tu opinión</span>
    </Link>
  );
}
