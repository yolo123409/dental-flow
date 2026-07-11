"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { Appointment } from "@/types";
import { getAppointmentById } from "@/services/appointments";

import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

export default function AppointmentDetailsPage() {
  const params = useParams();
  const router = useRouter();

  const appointmentId = String(params.id ?? "");

  const [appointment, setAppointment] =
    useState<Appointment | null>(null);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    loadAppointment();
  }, [appointmentId]);

  async function loadAppointment() {
    if (!appointmentId) return;

    try {
      setLoading(true);

      const data = await getAppointmentById(
        appointmentId
      );

      setAppointment(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <LoadingSpinner text="Loading appointment..." />
    );
  }

  if (!appointment) {
    return (
      <div className="flex h-screen items-center justify-center">
        Appointment not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-4xl font-bold">
            Appointment Details
          </h1>

          <p className="mt-2 text-slate-500">
            Appointment ID: {appointment.id}
          </p>

        </div>

        <Button
          variant="secondary"
          onClick={() => router.back()}
        >
          ← Back
        </Button>

      </div>

      <div className="rounded-2xl bg-white p-8 shadow">

        <div className="grid gap-8 md:grid-cols-2">

          <div>

            <h2 className="mb-6 text-xl font-bold">
              Patient
            </h2>

            <p className="text-lg font-semibold">
              {appointment.patients
                ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
                : "Unknown"}
            </p>

          </div>

          <div>

            <h2 className="mb-6 text-xl font-bold">
              Dentist
            </h2>

            <p className="text-lg font-semibold">
              {appointment.dentists?.full_name ??
                "Not Assigned"}
            </p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Date
            </h2>

            <p>{appointment.appointment_date}</p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Time
            </h2>

            <p>{appointment.appointment_time}</p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Duration
            </h2>

            <p>{appointment.duration ?? 0} minutes</p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Status
            </h2>

            <p>{appointment.status}</p>

          </div>

        </div>

      </div>

      <div className="rounded-2xl bg-white p-8 shadow">

        <h2 className="text-xl font-bold">
          Treatment
        </h2>

        <p className="mt-4">
          {appointment.treatment}
        </p>

      </div>

      <div className="rounded-2xl bg-white p-8 shadow">

        <h2 className="text-xl font-bold">
          Notes
        </h2>

        <p className="mt-4 whitespace-pre-wrap">
          {appointment.notes || "No notes"}
        </p>

      </div>

    </div>
  );
}