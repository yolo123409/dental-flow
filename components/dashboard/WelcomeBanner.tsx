"use client";

import { CalendarDays } from "lucide-react";

export default function WelcomeBanner() {
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
    <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-cyan-500 to-sky-400 p-8 text-white shadow-2xl">

      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">

        <div>

          <h1 className="text-4xl font-extrabold">
            {greeting} 👋
          </h1>

          <p className="mt-3 max-w-xl text-blue-100 text-lg">
            Welcome back to Dental Flow.
            Here&apos;s what&apos;s happening in your clinic today.
          </p>

        </div>

        <div className="rounded-2xl bg-white/20 p-5 backdrop-blur-md">

          <div className="flex items-center gap-3">

            <CalendarDays size={26} />

            <div>

              <p className="text-sm text-blue-100">
                Today
              </p>

              <p className="font-semibold text-lg">
                {today}
              </p>

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}