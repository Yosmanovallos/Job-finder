import Header from "./sections/Header";
import HeroDemo from "./sections/HeroDemo";
import SourcesAndProblem from "./sections/SourcesAndProblem";
import ComparisonAndProcess from "./sections/ComparisonAndProcess";
import ProductFeaturesPricingFaq from "./sections/ProductFeaturesPricingFaq";
import Footer from "./sections/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Header />
      <main>
        <HeroDemo />
        <SourcesAndProblem />
        <ComparisonAndProcess />
        <ProductFeaturesPricingFaq />
      </main>
      <Footer />
    </div>
  );
}
