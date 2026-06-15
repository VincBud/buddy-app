import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SectionHero } from "@/components/section-hero";
import { SectionProblem } from "@/components/section-problem";
import { SectionHowItWorks } from "@/components/section-how-it-works";
import { SectionSafety } from "@/components/section-safety";
import { SectionMvpStatus } from "@/components/section-mvp-status";
import { SectionWaitlist } from "@/components/section-waitlist";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <SectionHero />
        <SectionProblem />
        <SectionHowItWorks />
        <SectionSafety />
        <SectionMvpStatus />
        <SectionWaitlist />
      </main>
      <SiteFooter />
    </>
  );
}
