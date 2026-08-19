import { LandingNavbar } from "@/components/landing/navbar";
import { HeroSection } from "@/components/landing/hero-section";
import { ProductLines } from "@/components/landing/product-lines";
import { FullFunnelSection } from "@/components/landing/full-funnel";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { IndustryUseCases } from "@/components/landing/industry-use-cases";
import { FeatureTable } from "@/components/landing/feature-table";
import { PricingSection } from "@/components/landing/pricing-section";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/footer";
import { FloatingWidget } from "@/components/landing/floating-widget";

export const metadata = {
  title: "OZZO | CRM, Workforce & Field Sales in one platform",
  description:
    "OZZO unifies your CRM, field workforce and sales & distribution into one system — a web dashboard for managers and an Android app for reps, powered by WhatsApp and AI.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <LandingNavbar />
      <main>
        <HeroSection />
        <ProductLines />
        <FeaturesGrid />
        <FullFunnelSection />
        <IndustryUseCases />
        <FeatureTable />
        <PricingSection />
        <FAQ />
        <FinalCTA />
      </main>
      <LandingFooter />
      <FloatingWidget />
    </div>
  );
}
