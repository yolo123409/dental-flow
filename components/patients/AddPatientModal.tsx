"use client";

import { useState } from "react";

import PatientForm from "@/components/patients/PatientForm";
import { createPatient } from "@/services/patients";

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">

      <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-xl">

        <h2 className="text-3xl font-bold">
          Add Patient
        </h2>

        <div className="mt-6">
          <PatientForm
            form={form}
            onChange={update}
          />
        </div>

        <div className="mt-8 flex justify-end gap-4">

          <button
            onClick={onClose}
            className="rounded-lg border px-6 py-3"
          >
            Cancel
          </button>

          <button
            onClick={savePatient}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            {loading ? "Saving..." : "Save Patient"}
          </button>

        </div>

      </div>

    </div>
  );
}