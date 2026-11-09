import "./react-global.js";
import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { AppBody } from "../App.js";
import { AuthProvider } from "../auth/auth-provider.js";
import { setHomeSsrSeed, type HomeSsrSeed } from "../lib/home-ssr-seed.js";

// Server render of "/" and "/ve" (server.ts loads this module lazily, inside
// the home handler, and falls back to the plain snippet on any error). The
// tree mirrors index.tsx + App exactly — StrictMode, AuthProvider (logged
// out / loading, same as the browser's first render), router, AppBody — so
// the client can hydrateRoot it instead of replacing it: the visitor sees
// the real page from the first paint and LCP stays on the server's nodes.
export function renderHomeAppHtml(pathname: "/" | "/ve", seed: HomeSsrSeed): string {
  // renderToString is synchronous, so this module-level seed can't leak
  // between concurrent requests.
  setHomeSsrSeed(seed);
  try {
    return renderToString(
      <React.StrictMode>
        <AuthProvider>
          <StaticRouter location={pathname}>
            <AppBody />
          </StaticRouter>
        </AuthProvider>
      </React.StrictMode>
    );
  } finally {
    setHomeSsrSeed(null);
  }
}
