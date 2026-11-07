import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
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

ReactDOM.createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
