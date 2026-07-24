import Header from "./sections/Header.js";
import HeroDemo from "./sections/HeroDemo.js";
import SourcesAndProblem from "./sections/SourcesAndProblem.js";
import ComparisonAndProcess from "./sections/ComparisonAndProcess.js";
import ProductFeaturesPricingFaq from "./sections/ProductFeaturesPricingFaq.js";
import Footer from "./sections/Footer.js";
import { AuthProvider } from "./auth/auth-provider.js";

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans">
        <Header />
        <main>
          <HeroDemo />
          <SourcesAndProblem />
          <ComparisonAndProcess />
          <ProductFeaturesPricingFaq />
        </main>
        <Footer />
      </div>
    </AuthProvider>
  );
}
