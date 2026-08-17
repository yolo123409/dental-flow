"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import PatientForm, {
  PatientFormData,
} from "@/components/patients/PatientForm";

import { Patient } from "@/types/patient";
import { AcquisitionSource, PatientGender, ReferralSource } from "@/types";

import { updatePatient } from "@/services/patients";

import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

interface Props {
  open: boolean;
  patient: Patient | null;
  onClose: () => void;
  onSuccess: () => void;
}

function emptyForm(): PatientFormData {
  return {
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    gender: null,
    date_of_birth: "",
    address: "",
    allergies: "",
    medical_history: "",
    acquisition_source: null,
    referral_source: null,
    referral_source_name: "",
  };
}

export default function EditPatientModal({
  open,
  patient,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] =
    useState<PatientFormData>(emptyForm());

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
      acquisition_source: patient.acquisition_source ?? null,
      referral_source: patient.referral_source ?? null,
      referral_source_name: patient.referral_source_name ?? "",
    });
  }, [patient]);

  function update(
    field: keyof PatientFormData,
    value: string
  ) {
    setForm((prev) => {
      if (field === "gender") {
        return {
          ...prev,
          gender: value === "" ? null : (value as PatientGender),
        };
      }

      if (field === "acquisition_source") {
        const nextSource = value === "" ? null : (value as AcquisitionSource);

        // Switching away from Referral clears referral-specific fields
        // rather than silently carrying stale referral data along. This
        // is a local form-state change only - nothing is written until
        // Save Changes is pressed.
        if (nextSource === "Referral") {
          return { ...prev, acquisition_source: nextSource };
        }

        return {
          ...prev,
          acquisition_source: nextSource,
          referral_source: null,
          referral_source_name: "",
        };
      }

      if (field === "referral_source") {
        return {
          ...prev,
          referral_source: value === "" ? null : (value as ReferralSource),
        };
      }

      return { ...prev, [field]: value };
    });
  }

  async function saveChanges() {
    if (!patient) return;

    try {
      setLoading(true);

      const isReferral = form.acquisition_source === "Referral";

      await updatePatient(patient.id, {
        ...form,
        referral_source: isReferral ? form.referral_source : null,
        referral_source_name: isReferral
          ? form.referral_source_name.trim() || null
          : null,
      });

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
