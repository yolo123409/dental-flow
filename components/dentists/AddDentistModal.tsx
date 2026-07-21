"use client";

import { useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import DentistForm, {
  DentistFormData,
} from "./DentistForm";

import { createDentist } from "@/services/dentists";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function AddDentistModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] =
    useState<DentistFormData>({
      full_name: "",
      specialty: "",
      email: "",
      phone: "",
      active: true,
    });

function update(
  field: keyof DentistFormData,
  value: string | boolean
) {
  setForm((prev: DentistFormData) => ({
    ...prev,
    [field]: value,
  }));
}

  async function saveDentist() {
    if (!form.full_name.trim()) {
      toast.error("Dentist name is required.");
      return;
    }

    try {
      setLoading(true);

      await createDentist(form);

      await onSuccess();

      setForm({
        full_name: "",
        specialty: "",
        email: "",
        phone: "",
        active: true,
      });

      onClose();

    } catch (error) {
      console.error(error);
      toast.error("Failed to create dentist.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add Dentist"
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
            onClick={saveDentist}
            disabled={loading}
          >
            {loading ? "Saving..." : "Add Dentist"}
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