"use client";

import { useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { createTreatment } from "@/services/treatments";

interface Props {
  open: boolean;
  patientId: string;
  dentistId: string;
  appointmentId?: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function AddTreatmentModal({
  open,
  patientId,
  dentistId,
  appointmentId,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    treatment_name: "",
    tooth_number: "",
    diagnosis: "",
    prescription: "",
    procedure_notes: "",
    cost: "",
    duration: "",
    follow_up_date: "",
  });

  function update(
    field: keyof typeof form,
    value: string
  ) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function saveTreatment() {
    if (!form.treatment_name.trim()) {
      alert("Treatment name is required.");
      return;
    }

    try {
      setLoading(true);

      await createTreatment({
        patient_id: patientId,
        dentist_id: dentistId,
        appointment_id: appointmentId,

        treatment_name: form.treatment_name,
        tooth_number: form.tooth_number,
        diagnosis: form.diagnosis,
        prescription: form.prescription,
        procedure_notes: form.procedure_notes,

        cost: Number(form.cost || 0),

        duration: form.duration
          ? Number(form.duration)
          : undefined,

        follow_up_date:
          form.follow_up_date || undefined,
      });

      await onSuccess();

      setForm({
        treatment_name: "",
        tooth_number: "",
        diagnosis: "",
        prescription: "",
        procedure_notes: "",
        cost: "",
        duration: "",
        follow_up_date: "",
      });

      onClose();

    } catch (error) {
      console.error(error);
      alert("Failed to save treatment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title="New Treatment"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            onClick={saveTreatment}
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : "Save Treatment"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">

        <div>

          <label className="mb-2 block font-medium">
            Treatment Name
          </label>

          <input
            value={form.treatment_name}
            onChange={(e) =>
              update(
                "treatment_name",
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div className="grid gap-5 md:grid-cols-2">

          <div>

            <label className="mb-2 block font-medium">
              Tooth Number
            </label>

            <input
              value={form.tooth_number}
              onChange={(e) =>
                update(
                  "tooth_number",
                  e.target.value
                )
              }
              className="w-full rounded-xl border p-3"
            />

          </div>

          <div>

            <label className="mb-2 block font-medium">
              Cost (KES)
            </label>

            <input
              type="number"
              value={form.cost}
              onChange={(e) =>
                update("cost", e.target.value)
              }
              className="w-full rounded-xl border p-3"
            />

          </div>

        </div>

        <div>

          <label className="mb-2 block font-medium">
            Diagnosis
          </label>

          <textarea
            rows={3}
            value={form.diagnosis}
            onChange={(e) =>
              update(
                "diagnosis",
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div>

          <label className="mb-2 block font-medium">
            Procedure Notes
          </label>

          <textarea
            rows={4}
            value={form.procedure_notes}
            onChange={(e) =>
              update(
                "procedure_notes",
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div>

          <label className="mb-2 block font-medium">
            Prescription
          </label>

          <textarea
            rows={3}
            value={form.prescription}
            onChange={(e) =>
              update(
                "prescription",
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div className="grid gap-5 md:grid-cols-2">

          <div>

            <label className="mb-2 block font-medium">
              Duration (minutes)
            </label>

            <input
              type="number"
              value={form.duration}
              onChange={(e) =>
                update(
                  "duration",
                  e.target.value
                )
              }
              className="w-full rounded-xl border p-3"
            />

          </div>

          <div>

            <label className="mb-2 block font-medium">
              Follow-up Date
            </label>

            <input
              type="date"
              value={form.follow_up_date}
              onChange={(e) =>
                update(
                  "follow_up_date",
                  e.target.value
                )
              }
              className="w-full rounded-xl border p-3"
            />

          </div>

        </div>

      </div>
    </Modal>
  );
}