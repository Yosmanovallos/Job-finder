import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./sections/Header.js";
import HeroDemo from "./sections/HeroDemo.js";
import SourcesAndProblem from "./sections/SourcesAndProblem.js";
import ComparisonAndProcess from "./sections/ComparisonAndProcess.js";
import ProductFeaturesPricingFaq from "./sections/ProductFeaturesPricingFaq.js";
import Faq from "./sections/Faq.js";
import Footer from "./sections/Footer.js";
import ScrollToTop from "./components/ScrollToTop.js";
import { usePageMeta, PageMeta } from "./lib/use-page-meta.js";
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
const Login = lazy(() => import("./sections/Login.js"));
const ResetPassword = lazy(() => import("./sections/ResetPassword.js"));
const AuthCallback = lazy(() => import("./sections/AuthCallback.js"));
const Pricing = lazy(() => import("./sections/Pricing.js"));
const Legal = lazy(() => import("./sections/Legal.js"));
const Account = lazy(() => import("./sections/Account.js"));

function Landing() {
  usePageMeta({
    title: "BuscoTrabajo — Vacantes de Empleo en Colombia, Todas en un Solo Lugar",
    description:
      "Encuentra vacantes de empleo en Colombia de LinkedIn, Computrabajo, Elempleo, Magneto, Torre y otros portales, deduplicadas y verificadas en un solo dashboard. Gratis para vacantes con más de 48h publicadas."
  });

  return (
    <>
      <HeroDemo />
      <SourcesAndProblem />
      <ComparisonAndProcess />
      <ProductFeaturesPricingFaq />
    </>
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
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/empleos/:id/:slug?" element={<EmpleosRoute />} />
                <Route path="/empresas/:slug" element={<CompanyLanding />} />
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
            </Suspense>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
