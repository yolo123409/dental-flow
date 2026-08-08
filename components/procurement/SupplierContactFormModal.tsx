"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import {
  createSupplierContact,
  updateSupplierContact,
} from "@/services/suppliers";
import { logError } from "@/lib/logError";

import { SupplierContact } from "@/types/procurement";

interface Props {
  open: boolean;
  supplierId: string;
  contact: SupplierContact | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function SupplierContactFormModal({
  open,
  supplierId,
  contact,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setName(contact?.name ?? "");
    setJobTitle(contact?.job_title ?? "");
    setDepartment(contact?.department ?? "");
    setPhone(contact?.phone ?? "");
    setWhatsapp(contact?.whatsapp_number ?? "");
    setEmail(contact?.email ?? "");
    setIsPrimary(contact?.is_primary ?? false);
    setNotes(contact?.notes ?? "");
  }, [open, contact]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Contact name is required.");
      return;
    }

    const input = {
      name: name.trim(),
      job_title: jobTitle.trim() || null,
      department: department.trim() || null,
      phone: phone.trim() || null,
      whatsapp_number: whatsapp.trim() || null,
      email: email.trim() || null,
      is_primary: isPrimary,
      notes: notes.trim() || null,
    };

    try {
      setSaving(true);

      if (contact) {
        await updateSupplierContact(contact.id, input);
      } else {
        await createSupplierContact(supplierId, input);
      }

      toast.success(contact ? "Contact updated." : "Contact added.");

      onClose();
      onSaved();
    } catch (error) {
      logError("[SupplierContactFormModal] save failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to save contact."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      title={contact ? "Edit Contact" : "Add Contact"}
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={contact ? "Save Changes" : "Add Contact"}
    >
      <FormInput label="Contact Name" value={name} required onChange={setName} />

      <div className="grid grid-cols-2 gap-4">
        <FormInput label="Job Title" value={jobTitle} onChange={setJobTitle} />
        <FormInput label="Department" value={department} onChange={setDepartment} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormInput label="Phone" value={phone} onChange={setPhone} />
        <FormInput label="WhatsApp Number" value={whatsapp} onChange={setWhatsapp} />
      </div>

      <FormInput label="Email" value={email} onChange={setEmail} />

      <label className="flex items-center gap-3 text-sm text-graphite">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
          className="h-4 w-4 rounded border-sea-glass text-eucalyptus focus:ring-eucalyptus"
        />
        Primary Contact
      </label>

      <FormTextarea label="Notes" value={notes} onChange={setNotes} />
    </FormModal>
  );
}
