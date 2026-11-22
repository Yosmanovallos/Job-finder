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
  // Local-only dev login of the AI Resume Studio: true ONLY when the local
  // launcher (scripts/dev-resume-studio.ts) builds with
  // VITE_RESUME_STUDIO_DEV_AUTH=1 in its process environment. Every other
  // build gets the literal false and the branch is dropped from the bundle.
  define: {
    __RS_DEV_LOGIN__: JSON.stringify(process.env.VITE_RESUME_STUDIO_DEV_AUTH === "1")
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
});
