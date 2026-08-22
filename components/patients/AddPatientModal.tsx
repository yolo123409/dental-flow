"use client";

import { useState } from "react";
import { toast } from "sonner";

import PatientForm, { PatientFormData } from "@/components/patients/PatientForm";
import { createPatient } from "@/services/patients";

import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

import { AcquisitionSource, PatientGender, ReferralSource } from "@/types";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;
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
    acquisition_source: "Unknown",
    referral_source: null,
    referral_source_name: "",
  };
}

export default function AddPatientModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] =
    useState<PatientFormData>(emptyForm());

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
        // rather than silently carrying stale referral data along.
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

  async function savePatient() {
    if (!form.first_name.trim()) {
      toast.error("First name is required.");
      return;
    }

    if (!form.last_name.trim()) {
      toast.error("Last name is required.");
      return;
    }

    if (!form.phone.trim()) {
      toast.error("Phone number is required.");
      return;
    }

    setLoading(true);

    try {
      const isReferral = form.acquisition_source === "Referral";

      await createPatient({
        ...form,
        referral_source: isReferral ? form.referral_source : null,
        referral_source_name: isReferral
          ? form.referral_source_name.trim() || null
          : null,
      });

      onSuccess();
      onClose();

      setForm(emptyForm());

    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Unable to save patient.", "Save patient error:")
      );
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
