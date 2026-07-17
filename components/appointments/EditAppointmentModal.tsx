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

  onSuccess: () => void | Promise<void>;
}

const EMPTY_FORM: AppointmentFormData = {
  patient_id: "",
  dentist_id: "",
  treatment: "",
  appointment_date: "",
  appointment_time: "",
  notes: "",
  status: "Scheduled",
};

export default function EditAppointmentModal({
  open,
  appointment,
  patients,
  dentists,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] =
    useState(false);

  const [form, setForm] =
    useState<AppointmentFormData>(
      EMPTY_FORM
    );

  useEffect(() => {
    if (!open) return;

    if (!appointment) {
      setForm(EMPTY_FORM);
      return;
    }

    setForm({
      patient_id:
        appointment.patient_id,

      dentist_id:
        appointment.dentist_id ??
        "",

      treatment:
        appointment.treatment,

      appointment_date:
        appointment.appointment_date,

      appointment_time:
        appointment.appointment_time,

      notes:
        appointment.notes ?? "",

      status:
        appointment.status,
    });
  }, [open, appointment]);

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

    if (
      !form.patient_id ||
      !form.appointment_date ||
      !form.appointment_time
    ) {
      alert(
        "Please complete all required fields."
      );
      return;
    }

    try {
      setLoading(true);

      await updateAppointment(
        appointment.id,
        form
      );

      await onSuccess();

      handleClose();
    } catch (error) {
      console.error(error);

      alert(
        "Failed to update appointment."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;

    setForm(EMPTY_FORM);

    onClose();
  }

  return (
    <Modal
      open={open}
      title="Edit Appointment"
      onClose={handleClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            onClick={
              saveChanges
            }
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