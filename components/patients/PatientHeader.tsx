"use client";

interface Props {
  total: number;
}

export default function PatientHeader({
  total,
}: Props) {
  return (
    <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">

      <div>

        <h1 className="text-4xl font-bold">
          Patients
        </h1>

        <p className="mt-2 text-slate-500">
          Manage all patient records.
        </p>

      </div>

      <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-5 text-white">

        <p className="text-sm opacity-90">
          Total Patients
        </p>

        <h2 className="text-4xl font-bold">
          {total}
        </h2>

      </div>

    </div>
  );
}