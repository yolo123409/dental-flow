"use client";

export type AppointmentStatus =
  | "Scheduled"
  | "Ongoing"
  | "Completed"
  | "Cancelled"
  | "Missed";

export interface AppointmentFormData {
  patient_id: string;
  dentist_id: string;
  treatment: string;
  appointment_date: string;
  appointment_time: string;
  notes: string;
  status: AppointmentStatus;
}

import {
  PatientOption,
  DentistOption,
} from "@/types/options";

interface AppointmentFormProps {
  form: AppointmentFormData;

  patients: PatientOption[];

  dentists: DentistOption[];

  onChange: (
    field: keyof AppointmentFormData,
    value: string
  ) => void;
}

export default function AppointmentForm({
  form,
  patients,
  dentists,
  onChange,
}: AppointmentFormProps) {
  return (
    <div className="space-y-5">

      {/* Patient */}

      <div>
        <label className="mb-2 block font-medium">
          Patient
        </label>

        <select
          value={form.patient_id}
          onChange={(e) =>
            onChange("patient_id", e.target.value)
          }
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus"
        >
          <option value="">
            Select Patient
          </option>

          {patients.map((patient) => (
            <option
              key={patient.id}
              value={patient.id}
            >
              {patient.first_name} {patient.last_name}
            </option>
          ))}
        </select>
      </div>

      {/* Dentist */}

      <div>
        <label className="mb-2 block font-medium">
          Dentist
        </label>

        <select
          value={form.dentist_id}
          onChange={(e) =>
            onChange("dentist_id", e.target.value)
          }
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus"
        >
          <option value="">
            Select Dentist
          </option>

          {dentists.map((dentist) => (
            <option
              key={dentist.id}
              value={dentist.id}
            >
              {dentist.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Treatment */}

      <div>
        <label className="mb-2 block font-medium">
          Treatment
        </label>

        <input
          type="text"
          value={form.treatment}
          onChange={(e) =>
            onChange("treatment", e.target.value)
          }
          placeholder="e.g. Root Canal"
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors hover:border-mineral/50 focus:border-eucalyptus"
        />
      </div>

      {/* Date & Time */}

      <div className="grid gap-5 md:grid-cols-2">

        <div>
          <label className="mb-2 block font-medium">
            Appointment Date
          </label>

          <input
            type="date"
            value={form.appointment_date}
            onChange={(e) =>
              onChange(
                "appointment_date",
                e.target.value
              )
            }
            className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus"
          />
        </div>

        <div>
          <label className="mb-2 block font-medium">
            Appointment Time
          </label>

          <input
            type="time"
            value={form.appointment_time}
            onChange={(e) =>
              onChange(
                "appointment_time",
                e.target.value
              )
            }
            className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus"
          />
        </div>

      </div>

      {/* Notes */}

      <div>
        <label className="mb-2 block font-medium">
          Notes
        </label>

        <textarea
          rows={4}
          value={form.notes}
          onChange={(e) =>
            onChange("notes", e.target.value)
          }
          placeholder="Additional appointment notes..."
          className="w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors hover:border-mineral/50 focus:border-eucalyptus"
        />
      </div>

      {/* Status */}

      <div>
        <label className="mb-2 block font-medium">
          Status
        </label>

        <select
          value={form.status}
          onChange={(e) =>
            onChange("status", e.target.value)
          }
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus"
        >
          <option value="Scheduled">
            Scheduled
          </option>

          <option value="Ongoing">
            Ongoing
          </option>

          <option value="Completed">
            Completed
          </option>

          <option value="Cancelled">
            Cancelled
          </option>

          <option value="Missed">
            Missed
          </option>
        </select>
      </div>

    </div>
  );
}
