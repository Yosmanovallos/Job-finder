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
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans">
          <Header />
          <main>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/dashboard" element={<Dashboard />} />
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
