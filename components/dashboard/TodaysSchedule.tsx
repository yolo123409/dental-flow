"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { Appointment } from "@/types/appointment";
import { getTodaysAppointments } from "@/services/appointments";
import CareRail from "@/components/ui/CareRail";

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
    <div className="rounded-lg border border-sea-glass bg-enamel p-6">

      <div className="mb-5 flex items-center gap-2">

        <CalendarDays className="text-eucalyptus" />

        <h2 className="font-display text-xl font-bold">
          Today&apos;s Schedule
        </h2>

      </div>

      {appointments.length === 0 ? (

        <p className="text-sm text-mineral">
          Your chairs are clear today. New visits will appear here as they are booked.
        </p>

      ) : (

        <div className="space-y-4">

          {appointments.map((appointment) => (

            <CareRail key={appointment.id} status={appointment.status} className="flex items-center justify-between rounded-lg border border-sea-glass bg-enamel p-4" showLabel={false}>

              <div>

                <p className="font-display font-bold">
                  Patient ID: {appointment.patient_id}
                </p>

                <p className="text-sm text-mineral">
                  {appointment.treatment || "General Consultation"}
                </p>

                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                  {appointment.status}
                </p>

              </div>

              <span className="rounded-full bg-sea-glass px-3 py-1 text-sm font-semibold text-eucalyptus">
                {appointment.appointment_time}
              </span>

            </CareRail>

          ))}

        </div>

      )}

    </div>
  );
}
