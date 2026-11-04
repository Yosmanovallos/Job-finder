import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { setHomeSsrSeed, type HomeSsrSeed } from "./lib/home-ssr-seed.js";
import { rememberFirstTouch } from "./lib/first-touch";

// Signup attribution (Fase A): read the landing URL and referrer once,
// before React mounts — outside any render, so hydration is unaffected, and
// before AppRoutes' VE redirect can drop the utm_* query string.
rememberFirstTouch();

// A reload of the homepage should land on the hero, not wherever the
// browser last left the scroll. Kept to "/" and "/ve" only: the dashboard
// and listing pages still rely on native restoration when the visitor
// comes back from a job's source site.
if ("scrollRestoration" in window.history && (location.pathname === "/" || location.pathname === "/ve")) {
  window.history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
}

const container = document.getElementById("app")!;
const tree = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
const homeSeed = (window as unknown as { __SSR_HOME__?: HomeSsrSeed }).__SSR_HOME__;

if (homeSeed && container.dataset.ssr === "home") {
  // "/" and "/ve" arrive server-rendered (src/server/home-ssr.tsx): adopt
  // that DOM instead of replacing it. The seed makes the first render match
  // the HTML; a mismatch would make React re-render the page from scratch,
  // so it is logged for the performance checks to catch.
  setHomeSsrSeed(homeSeed);
  ReactDOM.hydrateRoot(container, tree, {
    onRecoverableError(error) {
      console.warn("[home-ssr] hydration mismatch", error);
    }
  });
} else {
  // Every other route still replaces the server's plain SEO snippet.
  ReactDOM.createRoot(container).render(tree);
}
