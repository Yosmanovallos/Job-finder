import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

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
