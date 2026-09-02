"use client";

import { useEffect, useState } from "react";

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
  /** Phase B/C: the single planned treatment this appointment is for.
   * "" means "not linked" - unrelated to most appointments. */
  treatment_plan_item_id: string;
}

import {
  PatientOption,
  DentistOption,
} from "@/types/options";

import {
  getTreatmentPlans,
  getItemTeeth,
  isItemInvoiced,
} from "@/services/treatmentPlans";

interface LinkableTreatment {
  id: string;
  procedure: string;
  teeth: number[];
}

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
  const [linkableTreatments, setLinkableTreatments] = useState<
    LinkableTreatment[]
  >([]);

  // Re-fetched whenever the selected patient changes - only treatments
  // that aren't already Completed or invoiced make sense to link a NEW
  // appointment to (an already-billed or already-finished treatment has
  // nothing left for a future visit to complete).
  useEffect(() => {
    if (!form.patient_id) {
      setLinkableTreatments([]);
      return;
    }

    let cancelled = false;

    getTreatmentPlans(form.patient_id)
      .then((plans) => {
        if (cancelled) return;

        const items = plans
          .flatMap((plan) => plan.treatment_plan_items)
          .filter(
            (item) =>
              item.status !== "Completed" &&
              item.status !== "Cancelled" &&
              !isItemInvoiced(item)
          )
          .map((item) => ({
            id: item.id,
            procedure: item.procedure,
            teeth: getItemTeeth(item),
          }));

        setLinkableTreatments(items);
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
    };
  }, [form.patient_id]);

  // Only fires from the Patient <select>'s own onChange - a real,
  // user-driven switch - never from a parent handing down a whole new
  // form object (e.g. EditAppointmentModal prefilling from an existing
  // appointment, which must keep its saved treatment_plan_item_id).
  function handlePatientChange(value: string) {
    onChange("patient_id", value);
    onChange("treatment_plan_item_id", "");
  }

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
            handlePatientChange(e.target.value)
          }
          disabled={form.status === "Completed"}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
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
          disabled={form.status === "Completed"}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
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
          disabled={form.status === "Completed"}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {/* Link to planned treatment */}

      {form.patient_id && (
        <div>
          <label className="mb-2 block font-medium">
            Link to planned treatment
            <span className="ml-1 font-normal text-mineral">
              (optional)
            </span>
          </label>

          {linkableTreatments.length > 0 ? (
            <>
              <select
                value={form.treatment_plan_item_id}
                onChange={(e) =>
                  onChange("treatment_plan_item_id", e.target.value)
                }
                disabled={form.status === "Completed"}
                className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Not linked to a planned treatment</option>

                {linkableTreatments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.procedure}
                    {item.teeth.length > 0
                      ? ` (Tooth ${item.teeth.join(", ")})`
                      : ""}
                  </option>
                ))}
              </select>

              <p className="mt-1.5 text-xs text-mineral">
                Completing this appointment will offer to bill this specific
                treatment once it&apos;s confirmed done - never the rest of
                the plan.
              </p>
            </>
          ) : (
            <p className="min-h-11 flex items-center rounded-lg border border-dashed border-sea-glass bg-enamel px-3 py-2.5 text-sm text-mineral">
              No eligible planned treatments
            </p>
          )}
        </div>
      )}

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
            disabled={form.status === "Completed"}
            className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
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
            disabled={form.status === "Completed"}
            className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
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
          disabled={form.status === "Completed"}
          className="w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
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
          disabled={form.status === "Completed"}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="Scheduled">
            Scheduled
          </option>

          <option value="Ongoing">
            Ongoing
          </option>

          <option value="Cancelled">
            Cancelled
          </option>

          <option value="Missed">
            Missed
          </option>

          {/* Full-app audit fix C5 (Critical): "Completed" is intentionally
              NOT a normal, always-available option here - setting it via
              this plain dropdown bypassed treatment completion and billing
              entirely for any linked treatment, with no error and no
              trace. Completing an appointment must always go through the
              dedicated "Mark as Completed" action instead, which also
              offers to complete and bill the linked treatment when there
              is one (updateAppointment() itself also rejects status:
              "Completed" now, as a second line of defense). This option
              only renders at all so an ALREADY-Completed appointment's
              edit form doesn't misleadingly display "Scheduled" instead -
              it's disabled, so it can be seen but never (re-)selected. */}
          {form.status === "Completed" && (
            <option value="Completed" disabled>
              Completed
            </option>
          )}
        </select>

        {form.status === "Completed" && (
          <p className="mt-1.5 text-xs text-mineral">
            This appointment is completed - it&apos;s a historical record
            and can no longer be edited here.
          </p>
        )}
      </div>

    </div>
  );
}
