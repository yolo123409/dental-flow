"use client";

interface Props {
  total: number;
}

export default function DentistHeader({
  total,
}: Props) {
  return (
    <div>

      <h1 className="text-4xl font-bold tracking-tight">
        Dentists
      </h1>

      <p className="mt-2 text-slate-500">
        Manage your clinic's dentists, availability,
        and appointments.
      </p>

      <div className="mt-4 inline-flex items-center rounded-full bg-blue-100 px-4 py-2">

        <span className="text-sm font-semibold text-blue-700">
          {total} Registered Dentist{total !== 1 ? "s" : ""}
        </span>

      </div>

    </div>
  );
}