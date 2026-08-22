import Link from "next/link";
import { ArrowRight } from "lucide-react";

import Reveal from "@/components/marketing/Reveal";
import { ToothMark } from "@/components/marketing/decor";

export default function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-eucalyptus py-20 text-white sm:py-28">
      <ToothMark className="mkt-animate-float-slow pointer-events-none absolute -right-10 top-6 h-56 w-56 text-white/10 sm:h-72 sm:w-72" />
      <ToothMark className="mkt-animate-float pointer-events-none absolute -left-16 bottom-0 h-40 w-40 text-white/10" />

      <Reveal className="relative mx-auto max-w-2xl px-6 text-center">
        <h2 className="font-display text-3xl font-bold text-balance sm:text-4xl">
          Run your practice with clarity.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/85 text-pretty">
          Set up your clinic - or your whole organization - in minutes, and
          bring patients, appointments, and billing into one place.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/signup"
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-8 py-3.5 text-base font-semibold text-eucalyptus shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            Get Started
            <ArrowRight
              size={18}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>

          <Link
            href="/auth/login"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/30 px-8 py-3.5 text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-white/10"
          >
            Log In
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
