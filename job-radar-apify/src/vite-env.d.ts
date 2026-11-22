/// <reference types="vite/client" />

/**
 * true only in the build made by `npm run dev:resume-studio`
 * (VITE_RESUME_STUDIO_DEV_AUTH=1, vite.config.ts `define`). In every other
 * build it is the literal `false`, so the local dev-login branch of
 * ResumeStudio is removed from the bundle.
 */
declare const __RS_DEV_LOGIN__: boolean;

/**
 * R4c: RESUME_STUDIO_ENABLED === "true" at build time (vite.config.ts
 * `define`). Undefined outside Vite (the server-rendered home under tsx),
 * where Header.tsx reads process.env instead.
 */
declare const __RS_NAV__: boolean | undefined;
