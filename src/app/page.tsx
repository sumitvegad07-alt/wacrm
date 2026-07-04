import { LandingNavbar } from "@/components/landing/navbar";
import { HeroSection } from "@/components/landing/hero-section";
import { FullFunnelSection } from "@/components/landing/full-funnel";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { IndustryUseCases } from "@/components/landing/industry-use-cases";
import { FeatureTable } from "@/components/landing/feature-table";
import { PricingSection } from "@/components/landing/pricing-section";
import { LandingFooter } from "@/components/landing/footer";
import { FloatingWidget } from "@/components/landing/floating-widget";

export const metadata = {
  title: "WACRM | The Ultimate Business Operating System",
  description: "Unify your sales pipeline, field tracking, automated messaging, and customer support into a single, intelligent platform powered by WhatsApp and AI.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <LandingNavbar />
      <main>
        <HeroSection />
        <FullFunnelSection />
        <FeaturesGrid />
        <IndustryUseCases />
        <FeatureTable />
        <PricingSection />
      </main>
      <LandingFooter />
      <FloatingWidget />
    </div>
  );
}
