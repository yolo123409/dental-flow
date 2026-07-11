"use client";

interface Props {
  total: number;
}

export default function PatientHeader({
  total,
}: Props) {
  return (
    <div className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-4xl font-bold">
          Patients
        </h1>

        <p className="mt-2 text-slate-500">
          Manage all registered patients.
        </p>
      </div>

      <div className="rounded-2xl bg-blue-50 px-5 py-3">
        <p className="text-sm text-slate-500">
          Total Patients
        </p>

        <p className="text-2xl font-bold text-blue-600">
          {total}
        </p>
      </div>
    </div>
  );
}