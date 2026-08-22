import Nav from "@/components/marketing/Nav";
import Hero from "@/components/marketing/Hero";
import Reveal from "@/components/marketing/Reveal";
import PatientShowcase from "@/components/marketing/sections/PatientShowcase";
import AppointmentsShowcase from "@/components/marketing/sections/AppointmentsShowcase";
import OdontogramShowcase from "@/components/marketing/sections/OdontogramShowcase";
import BillingShowcase from "@/components/marketing/sections/BillingShowcase";
import DocumentsShowcase from "@/components/marketing/sections/DocumentsShowcase";
import MultiBranchShowcase from "@/components/marketing/sections/MultiBranchShowcase";
import AnalyticsShowcase from "@/components/marketing/sections/AnalyticsShowcase";
import SecuritySection from "@/components/marketing/SecuritySection";
import FinalCTA from "@/components/marketing/FinalCTA";
import Footer from "@/components/marketing/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-porcelain">
      <Nav />

      <main>
        <Hero />

        <section id="features" className="scroll-mt-24 pt-20 sm:pt-24">
          <Reveal className="mx-auto max-w-2xl px-6 text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-eucalyptus">
              Everything, connected
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold text-graphite text-balance sm:text-4xl">
              Seven parts of your practice. One system.
            </h2>
            <p className="mt-4 text-base leading-7 text-mineral text-pretty">
              Built specifically for the day-to-day of running a dental
              clinic - from the front desk to the ledger.
            </p>
          </Reveal>

          <div className="divide-y divide-sea-glass">
            <PatientShowcase />
            <AppointmentsShowcase />
          </div>
        </section>

        <OdontogramShowcase />

        <div className="divide-y divide-sea-glass">
          <BillingShowcase />
          <DocumentsShowcase />
          <MultiBranchShowcase />
          <AnalyticsShowcase />
        </div>

        <SecuritySection />
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
}
