"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import PatientForm, {
  PatientFormData,
} from "@/components/patients/PatientForm";

import { Patient } from "@/types/patient";
import { PatientGender } from "@/types";

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

  useEffect(() => {
    if (!patient) return;

    setForm({
      first_name: patient.first_name ?? "",
      last_name: patient.last_name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      gender: patient.gender,
      date_of_birth: patient.date_of_birth ?? "",
      address: patient.address ?? "",
      allergies: patient.allergies ?? "",
      medical_history: patient.medical_history ?? "",
    });
  }, [patient]);

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

  async function saveChanges() {
    if (!patient) return;

    try {
      setLoading(true);

      await updatePatient(patient.id, form);

      onSuccess();
      onClose();

    } catch (error) {
      console.error(error);
      toast.error("Failed to update patient.");
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
            {loading
              ? "Saving..."
              : "Save Changes"}
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