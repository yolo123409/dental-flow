"use client";

import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import DentistForm, {
  DentistFormData,
} from "./DentistForm";

import { Dentist } from "@/types/dentist";
import { updateDentist } from "@/services/dentists";

interface Props {
  open: boolean;
  dentist: Dentist | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function EditDentistModal({
  open,
  dentist,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<DentistFormData>({
    full_name: "",
    specialty: "",
    email: "",
    phone: "",
    active: true,
  });

  useEffect(() => {
    if (!dentist) return;

    setForm({
      full_name: dentist.full_name,
      specialty: dentist.specialty ?? "",
      email: dentist.email ?? "",
      phone: dentist.phone ?? "",
      active: dentist.active,
    });
  }, [dentist]);

  function update(
    field: keyof DentistFormData,
    value: string | boolean
  ) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function saveChanges() {
    if (!dentist) return;

    try {
      setLoading(true);

      await updateDentist(dentist.id, form);

      await onSuccess();

      onClose();

    } catch (error) {
      console.error(error);
      alert("Failed to update dentist.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Edit Dentist"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
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
      <DentistForm
        form={form}
        onChange={update}
      />
    </Modal>
  );
}