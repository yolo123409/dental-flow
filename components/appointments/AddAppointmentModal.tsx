"use client";

import { useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import AppointmentForm, {
  AppointmentFormData,
} from "./AppointmentForm";

import { createAppointment } from "@/services/appointments";

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface DentistOption {
  id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  patients: PatientOption[];
  dentists: DentistOption[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function AddAppointmentModal({
  open,
  patients,
  dentists,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] =
    useState<AppointmentFormData>({
      patient_id: "",
      dentist_id: "",
      treatment: "",
      appointment_date: "",
      appointment_time: "",
      notes: "",
      status: "Scheduled",
    });

  function update(
    field: keyof AppointmentFormData,
    value: string
  ) {
    setForm((prev) => ({
      ...prev,
      [field]:
        field === "status"
          ? (value as AppointmentFormData["status"])
          : value,
    }));
  }

  async function saveAppointment() {
    if (
      !form.patient_id ||
      !form.appointment_date ||
      !form.appointment_time
    ) {
      alert("Please complete all required fields.");
      return;
    }

    try {
      setLoading(true);

      await createAppointment(form);

      await onSuccess();

      setForm({
        patient_id: "",
        dentist_id: "",
        treatment: "",
        appointment_date: "",
        appointment_time: "",
        notes: "",
        status: "Scheduled",
      });

      onClose();

    } catch (error) {
      console.error(error);
      alert("Failed to create appointment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Book Appointment"
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
            onClick={saveAppointment}
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : "Book Appointment"}
          </Button>
        </>
      }
    >
      <AppointmentForm
        form={form}
        patients={patients}
        dentists={dentists}
        onChange={update}
      />
    </Modal>
  );
}