"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { Appointment } from "@/types/appointment";
import { getTodaysAppointments } from "@/services/appointments";

export default function TodaysSchedule() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  async function loadAppointments() {
    const data = await getTodaysAppointments();
    setAppointments(data);
  }

  useEffect(() => {
    loadAppointments();
  }, []);

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">

      <div className="mb-5 flex items-center gap-2">

        <CalendarDays className="text-blue-600" />

        <h2 className="text-xl font-bold">
          Today&apos;s Schedule
        </h2>

      </div>

      {appointments.length === 0 ? (

        <p className="text-slate-500">
          No appointments scheduled today.
        </p>

      ) : (

        <div className="space-y-4">

          {appointments.map((appointment) => (

            <div
              key={appointment.id}
              className="flex items-center justify-between rounded-xl border p-4"
            >

              <div>

                <p className="font-semibold">
                  Patient ID: {appointment.patient_id}
                </p>

                <p className="text-sm text-slate-500">
                  {appointment.treatment || "General Consultation"}
                </p>

                <p className="text-xs text-slate-400">
                  {appointment.status}
                </p>

              </div>

              <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
                {appointment.appointment_time}
              </span>

            </div>

          ))}

        </div>

      )}

    </div>
  );
}