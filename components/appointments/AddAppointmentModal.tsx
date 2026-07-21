"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import AppointmentForm, {
  AppointmentFormData,
} from "./AppointmentForm";

import { createAppointment } from "@/services/appointments";

import {
  PatientOption,
  DentistOption,
} from "@/types/options";

interface Props {
  open: boolean;

  patients: PatientOption[];
  dentists: DentistOption[];

  onClose: () => void;
  onSuccess: () => Promise<void>;

  defaultDate?: string;
  defaultTime?: string;
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

export default function AddAppointmentModal({
  open,
  patients,
  dentists,
  onClose,
  onSuccess,
  defaultDate,
  defaultTime,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] =
    useState<AppointmentFormData>(
      EMPTY_FORM
    );

  useEffect(() => {
    if (!open) return;

    setForm({
      ...EMPTY_FORM,
      appointment_date:
        defaultDate ?? "",
      appointment_time:
        defaultTime ?? "",
    });
  }, [
    open,
    defaultDate,
    defaultTime,
  ]);

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
      toast.error(
        "Please complete all required fields."
      );
      return;
    }

    try {
      setLoading(true);

      await createAppointment(form);

      await onSuccess();

      setForm(EMPTY_FORM);

      onClose();
    } catch (error) {
      console.error(error);

      toast.error(
        "Failed to create appointment."
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
      title="Book Appointment"
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
              saveAppointment
            }
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