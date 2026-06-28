"use client";

import { Appointment } from "@/types/appointment";
import AppointmentCard from "./AppointmentCard";

interface Props {
  appointments: Appointment[];
  onView?: (appointment: Appointment) => void;
  onEdit?: (appointment: Appointment) => void;
  onDelete?: (appointment: Appointment) => void;
}

export default function AppointmentGrid({
  appointments,
  onView,
  onEdit,
  onDelete,
}: Props) {
  if (appointments.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed bg-white py-16 text-center">
        <h2 className="text-2xl font-bold">
          No appointments
        </h2>

        <p className="mt-2 text-slate-500">
          Book your first appointment to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {appointments.map((appointment) => (
        <AppointmentCard
          key={appointment.id}
          appointment={appointment}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}