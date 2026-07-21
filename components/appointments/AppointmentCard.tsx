"use client";

import {
  Calendar,
  Clock,
  Stethoscope,
  FileText,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react";

import { Appointment } from "@/types/appointment";
import { useRouter } from "next/navigation";

interface Props {
  appointment: Appointment;
  onView?: (appointment: Appointment) => void;
  onEdit?: (appointment: Appointment) => void;
  onDelete?: (appointment: Appointment) => void;
}

export default function AppointmentCard({
  appointment,
  onEdit,
  onDelete,
}: Props) {
  const badgeColor = {
    Scheduled: "bg-blue-100 text-blue-700",
    Completed: "bg-green-100 text-green-700",
    Cancelled: "bg-red-100 text-red-700",
  }[appointment.status] ?? "bg-slate-100 text-slate-700";

  const patientName = appointment.patients
    ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
    : "Unknown Patient";

  const initials = patientName
    .split(" ")
    .map((name) => name.charAt(0))
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const formattedDate = new Date(
    appointment.appointment_date
  ).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const router = useRouter();

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">

      <div className="mb-6 flex items-center justify-between">

        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeColor}`}
        >
          {appointment.status}
        </span>

        <span className="text-sm text-slate-500">
          {appointment.duration} min
        </span>

      </div>

      <div className="space-y-5">

        <div className="flex items-center gap-4">

          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
            {initials}
          </div>

          <div>

            <p className="text-xs uppercase tracking-wide text-slate-500">
              Patient
            </p>

            <p className="font-semibold text-slate-800">
              {patientName}
            </p>

          </div>

        </div>

        <div className="flex items-center gap-3">

          <Stethoscope
            size={18}
            className="text-blue-600"
          />

          <div>

            <p className="text-xs uppercase text-slate-500">
              Dentist
            </p>

            <p className="font-medium">
              {appointment.dentists?.full_name ??
                "No Dentist"}
            </p>

          </div>

        </div>

        <div className="flex items-center gap-3">

          <Calendar
            size={18}
            className="text-blue-600"
          />

          <span>{formattedDate}</span>

        </div>

        <div className="flex items-center gap-3">

          <Clock
            size={18}
            className="text-blue-600"
          />

          <span>{appointment.appointment_time}</span>

        </div>

        <div className="flex items-start gap-3">

          <FileText
            size={18}
            className="mt-1 text-blue-600"
          />

          <div>

            <p className="font-semibold">
              {appointment.treatment}
            </p>

            <p className="text-sm text-slate-500">
              {appointment.notes || "No notes provided"}
            </p>

          </div>

        </div>

      </div>

      <div className="mt-8 flex gap-2 border-t pt-5">

        <button
  onClick={() =>
    router.push(
      `/admin/appointments/${appointment.id}`
    )
  }
  className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-slate-100"
>
  <Eye size={16} />
  View
</button>

        <button
          onClick={() => onEdit?.(appointment)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          <Pencil size={16} />
          Edit
        </button>

        <button
          onClick={() => onDelete?.(appointment)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
        >
          <Trash2 size={16} />
          Delete
        </button>

      </div>

    </div>
  );
}