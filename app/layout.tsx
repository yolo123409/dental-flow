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

export const metadata: Metadata = {
  title: {
    default: "Dental Flow",
    template: "%s | Dental Flow",
  },
  description: "AI-Powered Dental Clinic Management Platform",
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
