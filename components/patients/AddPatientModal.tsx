"use client";

import { useState } from "react";

import PatientForm from "@/components/patients/PatientForm";
import { createPatient } from "@/services/patients";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";


interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddPatientModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    gender: "",
    date_of_birth: "",
    address: "",
    allergies: "",
    medical_history: "",
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

  async function savePatient() {
    if (!form.first_name.trim()) {
      alert("First name is required.");
      return;
    }

    if (!form.last_name.trim()) {
      alert("Last name is required.");
      return;
    }

    if (!form.phone.trim()) {
      alert("Phone number is required.");
      return;
    }

    setLoading(true);

    try {
      await createPatient(form);

      onSuccess();
      onClose();

      setForm({
        first_name: "",
        last_name: "",
        phone: "",
        email: "",
        gender: "",
        date_of_birth: "",
        address: "",
        allergies: "",
        medical_history: "",
      });

    } catch (error) {
      console.error(error);
      alert("Failed to save patient.");
    } finally {
      setLoading(false);
    }
  }

  return (
  <Modal
    open={open}
    title="Add Patient"
    onClose={onClose}
    footer={
      <>
        <Button
          variant="secondary"
          onClick={onClose}
        >
          Cancel
        </Button>

        <Button
          onClick={savePatient}
          disabled={loading}
        >
          {loading ? "Saving..." : "Save Patient"}
        </Button>
      </>
    }
  >

    <PatientForm
      form={form}
      onChange={update}
    />

  </Modal>
);
}