"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CalendarCheck, TrendingUp, Building2 } from "lucide-react";

const surfaceIn = {
  hidden: { opacity: 0, y: 40, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] as const },
  },
};

const panelIn = (delay: number) => ({
  hidden: { opacity: 0, y: 24, scale: 0.92 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
  },
});

const appointments = [
  { time: "09:00", patient: "Patient 001", type: "Cleaning", branch: "Westlands" },
  { time: "10:30", patient: "Patient 002", type: "Root Canal", branch: "Westlands" },
  { time: "11:15", patient: "Patient 003", type: "Consultation", branch: "Karen" },
];

const chartPoints = "0,38 20,30 40,34 60,20 80,24 100,10 120,16";

export default function HeroVisual() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      {/* Main dashboard surface */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={reduceMotion ? { hidden: { opacity: 1 }, show: { opacity: 1 } } : surfaceIn}
        className="relative rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_30px_80px_-30px_rgba(23,85,82,0.35)]"
      >
        <div className="flex items-center justify-between border-b border-sea-glass pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Westlands Branch
            </p>
            <p className="font-display text-lg font-semibold text-graphite">
              Today, Tuesday
            </p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sea-glass text-eucalyptus">
            <CalendarCheck size={18} />
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          {appointments.map((appt) => (
            <div
              key={appt.time}
              className="flex items-center justify-between rounded-xl bg-porcelain px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="data-metric text-sm font-semibold text-eucalyptus">
                  {appt.time}
                </span>
                <span className="text-sm font-medium text-graphite">
                  {appt.patient}
                </span>
              </div>
              <span className="text-xs font-semibold text-mineral">
                {appt.type}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-sea-glass px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Revenue trend
          </span>
          <svg viewBox="0 0 120 42" className="h-8 w-24" aria-hidden="true">
            <polyline
              points={chartPoints}
              fill="none"
              stroke="var(--eucalyptus)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={100}
              style={
                reduceMotion
                  ? undefined
                  : { strokeDasharray: 100, ["--mkt-dash" as string]: 100 }
              }
              className={reduceMotion ? undefined : "mkt-animate-draw"}
            />
          </svg>
        </div>
      </motion.div>

      {/* Floating panel: appointment count */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={reduceMotion ? { hidden: { opacity: 1 }, show: { opacity: 1 } } : panelIn(0.9)}
        className={`absolute -top-8 -right-6 hidden w-44 rounded-xl border border-sea-glass bg-enamel p-4 shadow-[0_20px_50px_-20px_rgba(23,85,82,0.4)] sm:block ${
          reduceMotion ? "" : "mkt-animate-float"
        }`}
      >
        <div className="flex items-center gap-2 text-mineral">
          <CalendarCheck size={14} />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Today
          </span>
        </div>
        <p className="data-metric mt-1 text-2xl font-bold text-graphite">12</p>
        <p className="text-xs text-mineral">appointments scheduled</p>
      </motion.div>

      {/* Floating panel: revenue */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={reduceMotion ? { hidden: { opacity: 1 }, show: { opacity: 1 } } : panelIn(1.05)}
        className={`absolute -bottom-10 -left-6 w-48 rounded-xl border border-sea-glass bg-enamel p-4 shadow-[0_20px_50px_-20px_rgba(23,85,82,0.4)] ${
          reduceMotion ? "" : "mkt-animate-float-slow"
        }`}
      >
        <div className="flex items-center gap-2 text-mineral">
          <TrendingUp size={14} />
          <span className="text-xs font-semibold uppercase tracking-wide">
            This month
          </span>
        </div>
        <p className="data-metric mt-1 text-2xl font-bold text-graphite">
          KES 482K
        </p>
        <p className="text-xs text-mineral">across 3 branches</p>
      </motion.div>

      {/* Floating panel: branch count */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={reduceMotion ? { hidden: { opacity: 1 }, show: { opacity: 1 } } : panelIn(1.2)}
        className={`absolute -bottom-6 right-4 hidden w-36 rounded-xl border border-sea-glass bg-eucalyptus p-3.5 text-white shadow-[0_20px_50px_-20px_rgba(23,85,82,0.5)] md:block ${
          reduceMotion ? "" : "mkt-animate-float"
        }`}
      >
        <div className="flex items-center gap-2 text-sea-glass">
          <Building2 size={14} />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Organization
          </span>
        </div>
        <p className="data-metric mt-1 text-xl font-bold">4 branches</p>
      </motion.div>
    </div>
  );
}
