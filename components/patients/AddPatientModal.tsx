"use client";

import { useState } from "react";

import PatientForm from "@/components/patients/PatientForm";
import { createPatient } from "@/services/patients";

import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

import { PatientGender } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface PatientFormData {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  gender: PatientGender | null;
  date_of_birth: string;
  address: string;
  allergies: string;
  medical_history: string;
}

export default function AddPatientModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] =
    useState<PatientFormData>({
      first_name: "",
      last_name: "",
      phone: "",
      email: "",
      gender: null,
      date_of_birth: "",
      address: "",
      allergies: "",
      medical_history: "",
    });

  function update(
    field: keyof PatientFormData,
    value: string
  ) {
    setForm((prev) => ({
      ...prev,
      [field]:
        field === "gender"
          ? ((value === ""
              ? null
              : value) as PatientGender | null)
          : value,
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
        gender: null,
        date_of_birth: "",
        address: "",
        allergies: "",
        medical_history: "",
      });

    } catch (error) {
  console.error("Save patient error:", error);

  if (error instanceof Error) {
    alert(error.message);
  } else {
    alert(JSON.stringify(error));
  }
}finally {
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
            {loading
              ? "Saving..."
              : "Save Patient"}
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