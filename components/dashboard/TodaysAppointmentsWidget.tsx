"use client";

import { useEffect, useState } from "react";

import Card from "@/components/ui/Card";

import { getTodaysAppointments } from "@/services/dashboard";

interface Appointment {
  id: string;
  appointment_time: string;
  treatment: string;

  patients?: {
    first_name: string;
    last_name: string;
  };

  dentists?: {
    full_name: string;
  };
}

export default function TodaysAppointmentsWidget() {

  const [appointments, setAppointments] =
    useState<Appointment[]>([]);

  async function loadAppointments() {
    const data = await getTodaysAppointments();
    setAppointments(data);
  }

  useEffect(() => {
    loadAppointments();
  }, []);

  return (
    <Card title="Today's Appointments">

      {appointments.length === 0 ? (

        <p className="text-slate-500">
          No appointments today.
        </p>

      ) : (

        <div className="space-y-4">

          {appointments.map((appointment) => (

            <div
              key={appointment.id}
              className="rounded-xl bg-slate-50 p-4"
            >

              <div className="flex justify-between">

                <div>

                  <p className="font-semibold">

                    {appointment.patients
                      ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
                      : "Unknown"}

                  </p>

                  <p className="text-sm text-slate-500">

                    {appointment.treatment}

                  </p>

                </div>

                <div className="text-right">

                  <p className="font-semibold">

                    {appointment.appointment_time}

                  </p>

                  <p className="text-sm text-slate-500">

                    {appointment.dentists?.full_name}

                  </p>

                </div>

              </div>

            </div>

          ))}

        </div>

      )}

    </Card>
  );
}