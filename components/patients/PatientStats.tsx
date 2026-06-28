"use client";

export default function PatientStats() {
  return (
    <div className="grid gap-6 md:grid-cols-3">

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          New This Month
        </p>

        <h2 className="mt-2 text-3xl font-bold">
          18
        </h2>

      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          Today's Visits
        </p>

        <h2 className="mt-2 text-3xl font-bold">
          12
        </h2>

      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          Outstanding Balance
        </p>

        <h2 className="mt-2 text-3xl font-bold text-red-600">
          KES 245,000
        </h2>

      </div>

    </div>
  );
}