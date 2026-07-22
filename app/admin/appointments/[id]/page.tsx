"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Appointment } from "@/types";
import {
  getAppointmentById,
  updateAppointment,
} from "@/services/appointments";

import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import CareRail from "@/components/ui/CareRail";
import StatusBadge from "@/components/ui/StatusBadge";
import Card from "@/components/ui/Card";

export default function AppointmentDetailsPage() {
  const params = useParams();
  const router = useRouter();

  const appointmentId = String(params.id ?? "");

  const [appointment, setAppointment] =
    useState<Appointment | null>(null);

  const [loading, setLoading] =
    useState(true);
  const [completing, setCompleting] = useState(false);

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

  useEffect(() => {
    loadAppointment();
  }, [appointmentId]);

  async function markAsCompleted() {
    if (!appointment) return;

    try {
      setCompleting(true);
      await updateAppointment(appointment.id, {
        status: "Completed",
      });
      setAppointment({
        ...appointment,
        status: "Completed",
      });
      toast.success("Appointment marked as completed.");
    } catch (error) {
      console.error("Failed to complete appointment:", error);
      toast.error("Failed to mark appointment as completed.");
    } finally {
      setCompleting(false);
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

          <h1 className="font-display text-3xl font-bold">
            Appointment Details
          </h1>

          <p className="mt-2 text-sm text-mineral">
            Appointment ID: {appointment.id}
          </p>

        </div>

        <div className="flex flex-wrap gap-3">
          {appointment.status === "Scheduled" && (
            <Button
              onClick={markAsCompleted}
              disabled={completing}
              aria-label="Mark this appointment as completed"
            >
              {completing
                ? "Marking as completed..."
                : "Mark as Completed"}
            </Button>
          )}

          <Button
            variant="secondary"
            onClick={() => router.back()}
          >
            ← Back
          </Button>
        </div>

      </div>

      <Card className="p-2">
        <CareRail status={appointment.status}>

        <div className="grid gap-8 md:grid-cols-2">

          <div>

            <h2 className="font-display mb-6 text-xl font-bold">
              Patient
            </h2>

            <p className="font-display text-lg font-bold">
              {appointment.patients
                ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
                : "Unknown"}
            </p>

          </div>

          <div>

            <h2 className="font-display mb-6 text-xl font-bold">
              Dentist
            </h2>

            <p className="font-display text-lg font-bold">
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

            <StatusBadge status={appointment.status} />

          </div>

        </div>
        </CareRail>
      </Card>

      <Card className="p-2">

        <h2 className="font-display text-xl font-bold">
          Treatment
        </h2>

        <p className="mt-4">
          {appointment.treatment}
        </p>

      </Card>

      <Card className="p-2">

        <h2 className="font-display text-xl font-bold">
          Notes
        </h2>

        <p className="mt-4 whitespace-pre-wrap">
          {appointment.notes || "No notes"}
        </p>

      </Card>

    </div>
  );
}
