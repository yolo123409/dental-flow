"use client";

import { useEffect, useState } from "react";

import PatientForm from "@/components/patients/PatientForm";
import { Patient } from "@/types/patient";
import { updatePatient } from "@/services/patients";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

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

  return (
  <Modal
    open={open}
    title="Edit Patient"
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
          onClick={saveChanges}
          disabled={loading}
        >
          {loading ? "Saving..." : "Save Changes"}
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