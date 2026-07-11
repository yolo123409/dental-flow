"use client";

import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import AppointmentForm, {
  AppointmentFormData,
} from "./AppointmentForm";

import { Appointment } from "@/types/appointment";
import { updateAppointment } from "@/services/appointments";

import {
  PatientOption,
  DentistOption,
} from "@/types/options";

interface Props {
  open: boolean;
  appointment: Appointment | null;
  patients: PatientOption[];
  dentists: DentistOption[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditAppointmentModal({
  open,
  appointment,
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

  useEffect(() => {
    if (!appointment) return;

    setForm({
      patient_id: appointment.patient_id,
      dentist_id:
        appointment.dentist_id ?? "",
      treatment: appointment.treatment,
      appointment_date:
        appointment.appointment_date,
      appointment_time:
        appointment.appointment_time,
      notes: appointment.notes ?? "",
      status: appointment.status,
    });
  }, [appointment]);

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

  async function saveChanges() {
    if (!appointment) return;

    try {
      setLoading(true);

      await updateAppointment(
        appointment.id,
        form
      );

      onSuccess();

      onClose();

    } catch (error) {
      console.error(error);
      alert("Failed to update appointment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Edit Appointment"
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
            onClick={saveChanges}
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : "Save Changes"}
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