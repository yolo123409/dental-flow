import type { Metadata } from "next";

import AuthRedirect from "@/components/marketing/AuthRedirect";
import LandingPage from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "Dental Flow | Dental Practice Management Platform",
  description:
    "Dental Flow is a dental practice management platform for clinics and multi-branch dental groups - patient records, appointments, billing, odontogram charting, clinical documents, and analytics in one place.",
  alternates: {
    canonical: "/",
  },
};

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://dentalflow.co.ke";

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Dental Flow",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Dental practice management platform for dental clinics and multi-branch dental groups: patient records, appointments and calendar, interactive odontogram, billing and financial management, clinical documents and imaging, staff and multi-branch management, and analytics and reporting.",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Dental Flow",
  url: siteUrl,
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />

      <AuthRedirect />

      <LandingPage />
    </>
  );
}
