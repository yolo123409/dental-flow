"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import HeroVisual from "@/components/marketing/HeroVisual";
import { ArchCurve } from "@/components/marketing/decor";

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export default function Hero() {
  const reduceMotion = useReducedMotion();

  const variants = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : item;

  return (
    <section className="relative overflow-hidden bg-porcelain">
      <div
        className="mkt-radial-glow pointer-events-none absolute inset-0"
        aria-hidden="true"
      />
      <ArchCurve className="pointer-events-none absolute inset-x-0 top-0 h-[300px] w-full text-sea-glass opacity-60" />

      <div className="relative mx-auto grid max-w-6xl gap-16 px-6 pb-24 pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pb-32 lg:pt-20">
        <motion.div
          initial="hidden"
          animate="show"
          variants={reduceMotion ? undefined : container}
        >
          <motion.span
            variants={variants}
            className="inline-flex rounded-full bg-sea-glass px-4 py-1.5 text-sm font-semibold text-deep-eucalyptus"
          >
            For dental clinics &amp; multi-branch dental groups
          </motion.span>

          <motion.h1
            variants={variants}
            className="mt-8 text-5xl font-bold leading-[1.05] tracking-tight text-graphite text-balance sm:text-6xl"
          >
            Your entire dental practice.
            <br />
            <span className="text-eucalyptus">Connected.</span>
          </motion.h1>

          <motion.p
            variants={variants}
            className="mt-6 max-w-xl text-lg leading-8 text-mineral text-pretty"
          >
            Patient records, appointments, dental charting, billing, and
            multi-branch operations - one connected system built around how
            a dental practice actually runs, from a single clinic to a
            growing organization.
          </motion.p>

          <motion.div
            variants={variants}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            <Link
              href="/auth/signup"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-eucalyptus px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-deep-eucalyptus hover:shadow-lg"
            >
              Get Started
              <ArrowRight
                size={18}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>

            <Link
              href="/auth/login"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-sea-glass bg-enamel/60 px-8 py-3.5 text-base font-semibold text-graphite transition-all hover:-translate-y-0.5 hover:bg-enamel"
            >
              Log In
            </Link>
          </motion.div>

          <motion.p
            variants={variants}
            className="mt-6 text-sm text-mineral"
          >
            No spreadsheets. No disconnected tools. One system for the
            front desk, the chair, and the ledger.
          </motion.p>
        </motion.div>

        <HeroVisual />
      </div>
    </section>
  );
}
