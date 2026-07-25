import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: "./static",
  // Absolute, not "./" — index.html is served (via server.ts's SPA fallback)
  // at any route depth (/legal/terminos, /dashboard, ...); a relative base
  // resolves against the current path's directory, so two-segment routes
  // requested "./assets/x.js" from the wrong directory and 404'd.
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
});
