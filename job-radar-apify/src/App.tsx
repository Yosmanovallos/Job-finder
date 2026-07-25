import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./sections/Header.js";
import HeroDemo from "./sections/HeroDemo.js";
import SourcesAndProblem from "./sections/SourcesAndProblem.js";
import ComparisonAndProcess from "./sections/ComparisonAndProcess.js";
import ProductFeaturesPricingFaq from "./sections/ProductFeaturesPricingFaq.js";
import Faq from "./sections/Faq.js";
import Footer from "./sections/Footer.js";
import { AuthProvider } from "./auth/auth-provider.js";

// Code-split everything past the landing page — visitors hitting "/" (the
// most common entrypoint) don't pay for Dashboard/Login/Pricing/Legal JS.
const Dashboard = lazy(() => import("./sections/Dashboard.js"));
const Login = lazy(() => import("./sections/Login.js"));
const Pricing = lazy(() => import("./sections/Pricing.js"));
const Legal = lazy(() => import("./sections/Legal.js"));
const Account = lazy(() => import("./sections/Account.js"));

function Landing() {
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
      style={{ backgroundColor: "#0A0B0D" }}
    >
      <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans">
          <Header />
          <main>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/login" element={<Login />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/legal/terminos" element={<Legal type="terminos" />} />
                <Route path="/legal/privacidad" element={<Legal type="privacidad" />} />
                <Route path="/legal/uso-aceptable" element={<Legal type="uso-aceptable" />} />
                <Route path="/legal/cookies" element={<Legal type="cookies" />} />
                <Route path="/cuenta" element={<Account />} />
                <Route path="/como-funciona" element={<ComparisonAndProcess />} />
                <Route path="/fuentes" element={<SourcesAndProblem />} />
                <Route path="/preguntas" element={<Faq />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
