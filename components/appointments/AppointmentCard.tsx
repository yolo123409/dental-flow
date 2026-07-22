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
import CareRail from "@/components/ui/CareRail";
import StatusBadge from "@/components/ui/StatusBadge";

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
    <div className="rounded-lg border border-sea-glass bg-enamel p-6">

      <CareRail status={appointment.status} showLabel={false}>

      <div className="mb-6 flex items-center justify-between gap-3">

        <StatusBadge status={appointment.status} />

        <span className="text-sm text-mineral">
          {appointment.duration} min
        </span>

      </div>

      <div className="space-y-5">

        <div className="flex items-center gap-4">

          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-eucalyptus text-lg font-bold text-white">
            {initials}
          </div>

          <div>

            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Patient
            </p>

            <p className="font-display font-bold text-graphite">
              {patientName}
            </p>

          </div>

        </div>

        <div className="flex items-center gap-3">

          <Stethoscope
            size={18}
            className="text-eucalyptus"
          />

          <div>

            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
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
            className="text-eucalyptus"
          />

          <span>{formattedDate}</span>

        </div>

        <div className="flex items-center gap-3">

          <Clock
            size={18}
            className="text-eucalyptus"
          />

          <span>{appointment.appointment_time}</span>

        </div>

        <div className="flex items-start gap-3">

          <FileText
            size={18}
            className="mt-1 text-eucalyptus"
          />

          <div>

            <p className="font-semibold">
              {appointment.treatment}
            </p>

            <p className="text-sm text-mineral">
              {appointment.notes || "No notes provided"}
            </p>

          </div>

        </div>

      </div>

      <div className="mt-8 flex gap-2 border-t border-sea-glass pt-5">

        <button
  onClick={() =>
    router.push(
      `/admin/appointments/${appointment.id}`
    )
  }
  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-sea-glass px-3 py-2 text-sm font-semibold transition-colors hover:bg-porcelain"
>
  <Eye size={16} />
  View
</button>

        <button
          onClick={() => onEdit?.(appointment)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-eucalyptus px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-deep-eucalyptus"
        >
          <Pencil size={16} />
          Edit
        </button>

        <button
          onClick={() => onDelete?.(appointment)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-clay px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-clay/90"
        >
          <Trash2 size={16} />
          Delete
        </button>

      </div>
      </CareRail>

    </div>
  );
}
