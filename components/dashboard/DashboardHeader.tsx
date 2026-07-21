"use client";

export default function DashboardHeader() {
  const hour = new Date().getHours();

  let greeting = "Good Evening";

  if (hour < 12) greeting = "{greeting}, Dr. Kamau 👋";
  else if (hour < 18) greeting = "Good Afternoon";

  const today = new Date().toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">
          {greeting} 👋
        </h1>

        <p className="mt-2 text-slate-500">
          {today}
        </p>
      </div>

      <div className="rounded-2xl bg-linear-to-r from-blue-600 to-indigo-600 px-8 py-5 text-white shadow-lg">
        <h2 className="text-lg font-semibold">
          Dental Flow
        </h2>

        <p className="text-sm opacity-90">
          AI-Powered Clinic Management
        </p>
      </div>
    </div>
  );
}