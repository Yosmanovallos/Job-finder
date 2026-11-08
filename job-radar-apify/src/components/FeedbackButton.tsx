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
      // Starts with the visible text ("Califícanos…") so voice-control users
      // can say what they see (WCAG 2.5.3, axe label-content-name-mismatch).
      aria-label="Califícanos y opina sobre BuscoTrabajo"
      className="ink-card-sm ink-lift fixed z-30 right-3 md:right-6 bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6 inline-flex items-center gap-2 h-11 rounded-full bg-white px-4 text-sm font-bold text-foreground no-underline"
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className="text-gold-2" fill="currentColor" stroke="hsl(var(--foreground))" strokeWidth={1.6} strokeLinejoin="round">
        <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" />
      </svg>
      <span className="md:hidden">Califícanos</span>
      <span className="hidden md:inline">Califícanos y opina</span>
    </Link>
  );
}
