"use client";

import { CalendarDays } from "lucide-react";

interface Props {
  clinicName?: string;
}

export default function WelcomeBanner({
  clinicName,
}: Props) {
  const hour = new Date().getHours();

  const greeting =
    hour < 12
      ? "Good Morning"
      : hour < 18
      ? "Good Afternoon"
      : "Good Evening";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <section className="mb-8 overflow-hidden rounded-xl border border-eucalyptus bg-eucalyptus p-6 text-white sm:p-8">

      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">

        <div>

          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            {greeting}
          </h1>

          <p className="mt-3 max-w-xl text-base text-white/80 sm:text-lg">
            Welcome back to {clinicName || "Dental Flow"}.
            Here&apos;s what&apos;s happening in your clinic today.
          </p>

        </div>

        <div className="rounded-lg border border-white/20 bg-white/10 p-5">

          <div className="flex items-center gap-3">

            <CalendarDays size={26} />

            <div>

              <p className="text-sm text-white/70">
                Today
              </p>

              <p className="font-semibold text-lg">
                {today}
              </p>

            </div>

          </div>

        </div>

      </div>

    </section>
  );
}
