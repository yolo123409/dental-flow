"use client";

import { CalendarDays } from "lucide-react";

interface Props {
  total: number;
}

export default function AppointmentHeader({
  total,
}: Props) {
  return (
    <div className="flex items-center justify-between">

      <div>

        <div className="flex items-center gap-3">

          <CalendarDays
            className="text-blue-600"
            size={36}
          />

          <h1 className="text-4xl font-bold">
            Appointments
          </h1>

        </div>

        <p className="mt-2 text-slate-500">
          Manage all clinic appointments.
        </p>

      </div>

      <div className="rounded-2xl bg-blue-600 px-6 py-4 text-white shadow">

        <p className="text-sm opacity-80">
          Total Appointments
        </p>

        <p className="text-3xl font-bold">
          {total}
        </p>

      </div>

    </div>
  );
}