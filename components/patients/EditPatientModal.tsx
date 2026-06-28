"use client";

import { useEffect, useState } from "react";

import PatientForm from "@/components/patients/PatientForm";
import { Patient } from "@/types/patient";
import { updatePatient } from "@/services/patients";

interface Props {
  open: boolean;
  patient: Patient | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditPatientModal({
  open,
  patient,
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

  useEffect(() => {
    if (!patient) return;

    setForm({
      first_name: patient.first_name ?? "",
      last_name: patient.last_name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      gender: patient.gender ?? "",
      date_of_birth: patient.date_of_birth ?? "",
      address: patient.address ?? "",
      allergies: patient.allergies ?? "",
      medical_history: patient.medical_history ?? "",
    });
  }, [patient]);

  function update(
    field: keyof typeof form,
    value: string
  ) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function saveChanges() {
    if (!patient) return;

    setLoading(true);

    try {
      await updatePatient(patient.id, form);

      onSuccess();
      onClose();
    } catch (error) {
      console.error(error);
      alert("Failed to update patient.");
    } finally {
      setLoading(false);
    }
  }

  if (!open || !patient) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">

      <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-xl">

        <h2 className="text-3xl font-bold">
          Edit Patient
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
            onClick={saveChanges}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            {loading ? "Saving..." : "Save Changes"}
          </button>

        </div>

      </div>

    </div>
  );
}