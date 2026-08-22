import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

import { AuthProvider } from "@/contexts/AuthContext";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://dentalflow.co.ke";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Dental Flow | Dental Practice Management Platform",
    template: "%s | Dental Flow",
  },
  description:
    "Dental Flow is a dental practice management platform for clinics and multi-branch dental groups - patient records, appointments, billing, odontogram charting, clinical documents, and analytics in one place.",
  openGraph: {
    title: "Dental Flow | Dental Practice Management Platform",
    description:
      "Patient records, appointments, billing, odontogram charting, clinical documents, and analytics - built for dental clinics and multi-branch dental groups.",
    url: siteUrl,
    siteName: "Dental Flow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dental Flow | Dental Practice Management Platform",
    description:
      "Patient records, appointments, billing, odontogram charting, clinical documents, and analytics - built for dental clinics and multi-branch dental groups.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sourceSans.variable} ${fraunces.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('dental-flow-theme');var d=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen bg-porcelain font-sans antialiased">

        <AuthProvider>

          {children}

        </AuthProvider>

        <Toaster
          position="top-right"
          richColors
          closeButton
          expand
          duration={3000}
        />

      </body>
    </html>
  );
}
