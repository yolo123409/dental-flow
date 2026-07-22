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
            className="text-eucalyptus"
            size={36}
          />

          <h1 className="font-display text-3xl font-bold">
            Appointments
          </h1>

        </div>

        <p className="mt-2 text-sm text-mineral">
          Manage all clinic appointments.
        </p>

      </div>

      <div className="rounded-lg bg-eucalyptus px-6 py-4 text-white">

        <p className="text-sm opacity-80">
          Total Appointments
        </p>

        <p className="data-metric text-3xl font-bold">
          {total}
        </p>

      </div>

    </div>
  );
}
