"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import { createSupplier, updateSupplier } from "@/services/suppliers";
import { logError } from "@/lib/logError";

import { Supplier } from "@/types/procurement";

interface Props {
  open: boolean;
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function SupplierFormModal({
  open,
  supplier,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(supplier?.name ?? "");
    setAddress(supplier?.address ?? "");
    setNotes(supplier?.notes ?? "");
  }, [open, supplier]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Supplier name is required.");
      return;
    }

    try {
      setSaving(true);

      if (supplier) {
        await updateSupplier(supplier.id, {
          name: name.trim(),
          address: address.trim() || null,
          notes: notes.trim() || null,
        });
      } else {
        await createSupplier({
          name: name.trim(),
          address: address.trim() || null,
          notes: notes.trim() || null,
        });
      }

      toast.success(supplier ? "Supplier updated." : "Supplier added.");

      onClose();
      onSaved();
    } catch (error) {
      logError("[SupplierFormModal] save failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to save supplier."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      title={supplier ? "Edit Supplier" : "Add Supplier"}
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={supplier ? "Save Changes" : "Add Supplier"}
    >
      <FormInput label="Supplier Name" value={name} required onChange={setName} />

      <FormInput label="Address" value={address} onChange={setAddress} />

      <FormTextarea label="Notes" value={notes} onChange={setNotes} />
    </FormModal>
  );
}
