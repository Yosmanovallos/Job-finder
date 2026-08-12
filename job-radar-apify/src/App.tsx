import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import Header from "./sections/Header.js";
import HeroDemo from "./sections/HeroDemo.js";
import SourcesAndProblem from "./sections/SourcesAndProblem.js";
import ComparisonAndProcess from "./sections/ComparisonAndProcess.js";
import ProductFeaturesPricingFaq from "./sections/ProductFeaturesPricingFaq.js";
import Faq from "./sections/Faq.js";
import Footer from "./sections/Footer.js";
import ScrollToTop from "./components/ScrollToTop.js";
import { usePageMeta, PageMeta } from "./lib/use-page-meta.js";
import { getCountryConfig } from "./countries/index.js";
import {
  getEffectiveCountry,
  getStoredCountry,
  setStoredCountry,
  isCountryScopedUnprefixed,
  isVePrefixed
} from "./lib/country-context.js";
import { AuthProvider } from "./auth/auth-provider.js";
import RequireAuth from "./auth/require-auth.js";

// Code-split everything past the landing page — visitors hitting "/" (the
// most common entrypoint) don't pay for Dashboard/Login/Pricing/Legal JS.
const Dashboard = lazy(() => import("./sections/Dashboard.js"));
// Dispatches to JobLanding (jobId, a UUID) or CategoryLanding (city/role
// slug) — see EmpleosRoute.tsx / job-seo.ts's isUuid for why one route
// pattern still covers both without colliding with server.ts's split.
const EmpleosRoute = lazy(() => import("./sections/EmpleosRoute.js"));
const CompanyLanding = lazy(() => import("./sections/CompanyLanding.js"));
const CompaniesDirectory = lazy(() => import("./sections/CompaniesDirectory.js"));
const Login = lazy(() => import("./sections/Login.js"));
const ResetPassword = lazy(() => import("./sections/ResetPassword.js"));
const AuthCallback = lazy(() => import("./sections/AuthCallback.js"));
const Pricing = lazy(() => import("./sections/Pricing.js"));
const Legal = lazy(() => import("./sections/Legal.js"));
const Account = lazy(() => import("./sections/Account.js"));
const AccountAiProviders = lazy(() => import("./sections/AccountAiProviders.js"));

function Landing() {
  // "/" (Colombia, default) vs "/ve" (Venezuela) — same pattern as
  // Dashboard.tsx: path-prefix detection, no route param, so this stays a
  // plain literal route in App.tsx instead of an optional-segment route.
  // By the time this mounts, AppRoutes below has already redirected away
  // from "/" if the visitor's stored preference was Venezuela, so a plain
  // prefix check here is safe.
  const location = useLocation();
  const country = getEffectiveCountry(location.pathname);
  const countryName = getCountryConfig(country).name;

  usePageMeta({
    title: `BuscoTrabajo — Vacantes de Empleo en ${countryName}, Todas en un Solo Lugar`,
    description: `Encuentra vacantes de empleo en ${countryName} de LinkedIn, Computrabajo${country === "CO" ? ", Elempleo, Magneto" : ""}, Torre y otros portales, deduplicadas y verificadas en un solo dashboard. Gratis para vacantes con más de 48h publicadas.`
  });

  return (
    <>
      <HeroDemo country={country} />
      <SourcesAndProblem country={country} />
      <ComparisonAndProcess />
      <ProductFeaturesPricingFaq country={country} />
    </>
  );
}

// Wraps <Routes> instead of sitting beside it as a plain redirect
// component: rendering <Navigate> HERE, in place of <Routes>, means the
// wrong-country page (e.g. Dashboard for Colombia) never mounts for even
// one tick when the visitor's stored preference is Venezuela — no flash of
// the wrong content before the redirect fires. This is what makes "click
// the logo, land on / with a VE preference stored, end up on /ve" and
// "click a hardcoded /dashboard link from Footer/Pricing/etc." both work
// without having to hunt down and edit every such link across the app.
function AppRoutes() {
  const location = useLocation();
  const path = location.pathname;
  const isVePath = isVePrefixed(path);
  const scoped = isCountryScopedUnprefixed(path);

  useEffect(() => {
    if (isVePath) setStoredCountry("VE");
    else if (scoped) setStoredCountry("CO");
  }, [path, isVePath, scoped]);

  if (!isVePath && scoped && getStoredCountry() === "VE") {
    return <Navigate to={path === "/" ? "/ve" : `/ve${path}`} replace />;
  }

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Dashboard />} />
      {/* Venezuela mirror — same components throughout, each one
          reads the country off the "/ve" prefix itself (see
          Dashboard.tsx's comment for the pattern every one of
          these follows). Job detail pages are the one exception:
          country-agnostic by design (see job-seo.ts's
          buildJobPath) and stay at the single /empleos/:id route
          for every country — no /ve equivalent, so the sitemap/
          Indexing API pipeline (which only ever knows about
          /empleos/) never emits a URL this router wouldn't also
          serve. Category pages are the one exception that DOES get
          a /ve-prefixed route — but only for roles (city pages
          never do, a city name alone is already unambiguous — see
          job-seo.ts's ResolvedCategory comment). */}
      <Route path="/ve" element={<Landing />} />
      <Route path="/ve/dashboard" element={<Dashboard />} />
      <Route path="/empleos/:id/:slug?" element={<EmpleosRoute />} />
      <Route path="/ve/empleos/:id" element={<EmpleosRoute />} />
      <Route path="/empresas" element={<CompaniesDirectory />} />
      <Route path="/empresas/:slug" element={<CompanyLanding />} />
      <Route path="/ve/empresas" element={<CompaniesDirectory />} />
      <Route path="/ve/empresas/:slug" element={<CompanyLanding />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/legal/terminos" element={<Legal type="terminos" />} />
      <Route path="/legal/privacidad" element={<Legal type="privacidad" />} />
      <Route path="/legal/uso-aceptable" element={<Legal type="uso-aceptable" />} />
      <Route path="/legal/cookies" element={<Legal type="cookies" />} />
      <Route
        path="/cuenta"
        element={
          <RequireAuth>
            <Account />
          </RequireAuth>
        }
      />
      {/* Ruta hermana plana, no anidada bajo /cuenta vía <Outlet> — mismo
          patrón que /empresas/:slug junto a /empresas. Fase 6 de
          docs/RESUME-STUDIO-PLAN.md; primera superficie visible de BYOK.
          RESUME_STUDIO_ENABLED (config.ts) sigue en false hoy, así que el
          link de navegación en Account.tsx no se muestra todavía — llegar
          aquí por URL directa cae en el propio guard de la página. */}
      <Route
        path="/cuenta/ai/providers"
        element={
          <RequireAuth>
            <AccountAiProviders />
          </RequireAuth>
        }
      />
      <Route
        path="/como-funciona"
        element={
          <>
            <PageMeta
              title="Cómo funciona BuscoTrabajo — Deduplicación y verificación de vacantes"
              description="BuscoTrabajo escanea varios portales de empleo en paralelo, elimina duplicados y verifica que cada vacante siga vigente antes de mostrarla."
            />
            <ComparisonAndProcess />
          </>
        }
      />
      <Route
        path="/fuentes"
        element={
          <>
            <PageMeta
              title="Fuentes de empleo que rastreamos — BuscoTrabajo"
              description="Vacantes agregadas de LinkedIn, Computrabajo, Elempleo, Magneto, Torre y otros portales de empleo en Colombia y LatAm, en un solo lugar."
            />
            <SourcesAndProblem />
          </>
        }
      />
      <Route
        path="/preguntas"
        element={
          <>
            <PageMeta
              title="Preguntas frecuentes — BuscoTrabajo"
              description="Resolvemos las dudas más comunes sobre fuentes, actualidad de las vacantes, el plan Pro y cómo funciona la deduplicación."
            />
            <Faq />
          </>
        }
      />
    </Routes>
  );
}

function RouteFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#fafafa" }}
    >
      <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        {/* No overflow-x-hidden here: setting overflow-x alone forces the
            browser to silently promote overflow-y from its default
            `visible` to `auto` too (a CSS quirk — the two axes can't be
            visible/non-visible at the same time), which turns this div into
            the page's real scroll container instead of the window. That
            breaks every `position: sticky` element anywhere below it (the
            dashboard's search bar and its split-pane detail panel included)
            — sticky positioning is computed against the nearest ancestor
            with non-visible overflow, and this one never actually needs to
            scroll internally (it has no height cap), so it just silently
            eats the stickiness. Sections that render wide decorative
            elements (HeroDemo, ComparisonAndProcess,
            ProductFeaturesPricingFaq) already scope their own
            overflow-x-hidden locally instead. */}
        <div className="min-h-screen bg-background text-foreground font-sans">
          <Header />
          <main>
            <Suspense fallback={<RouteFallback />}>
              <AppRoutes />
            </Suspense>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
