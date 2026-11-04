import React from "react";

// Imported FIRST by home-ssr.tsx, so it runs before any component module
// (some, like Footer.tsx, build JSX at module load).
//
// tsx reads tsconfig.json ("jsx": "react-jsx") from the working directory.
// Started from elsewhere (the isolated test runner uses a temp cwd) it falls
// back to the classic transform, which compiles every component's JSX to a
// bare `React.createElement`. Exposing React globally keeps the home render
// independent of where the process was started; with the automatic runtime
// (production: Render runs `npm run server` in job-radar-apify/) it's unused.
(globalThis as { React?: typeof React }).React ??= React;
