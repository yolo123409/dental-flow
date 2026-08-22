"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormInput from "@/components/ui/FormInput";
import FormModal from "@/components/ui/FormModal";

import type {
  PatientNote,
  CreatePatientNoteData,
  UpdatePatientNoteData,
} from "@/types/patientNote";
import { getSafeErrorMessage } from "@/lib/logError";

interface PatientNoteModalProps {
  open: boolean;
  patientId: string;
  note: PatientNote | null;
  onClose: () => void;
  onCreate: (
    data: CreatePatientNoteData
  ) => Promise<void>;
  onUpdate: (
    data: UpdatePatientNoteData
  ) => Promise<void>;
}

interface FormState {
  title: string;
  content: string;
  is_pinned: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  content: "",
  is_pinned: false,
};

export default function PatientNoteModal({
  open,
  patientId,
  note,
  onClose,
  onCreate,
  onUpdate,
}: PatientNoteModalProps) {
  const [form, setForm] =
    useState<FormState>(EMPTY_FORM);

  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      return;
    }

    if (note) {
      setForm({
        title: note.title,
        content: note.content,
        is_pinned: note.is_pinned,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, note]);

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast.error("Please enter a title.");
      return;
    }

    if (!form.content.trim()) {
      toast.error("Please enter a clinical note.");
      return;
    }

    try {
      setSaving(true);

      if (note) {
        await onUpdate({
          title: form.title.trim(),
          content: form.content.trim(),
          is_pinned: form.is_pinned,
        });
      } else {
        await onCreate({
          patient_id: patientId,
          title: form.title.trim(),
          content: form.content.trim(),
          is_pinned: form.is_pinned,
        });
      }

      setForm(EMPTY_FORM);

      toast.success(
        note ? "Note updated." : "Note added."
      );
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to save note.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      title={
        note
          ? "Edit Clinical Note"
          : "New Clinical Note"
      }
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={
        note
          ? "Save Changes"
          : "Create Note"
      }
      cancelText="Cancel"
    >
      <FormInput
        label="Title"
        value={form.title}
        placeholder="Enter note title"
        onChange={(value) =>
          setForm((prev) => ({
            ...prev,
            title: value,
          }))
        }
      />

      <div>
        <label className="mb-2 block font-medium">
          Clinical Note
        </label>

        <textarea
          value={form.content}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              content: e.target.value,
            }))
          }
          rows={8}
          className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
          placeholder="Write your clinical note..."
        />
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={form.is_pinned}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              is_pinned: e.target.checked,
            }))
          }
        />

        <span>Pin this note</span>
      </label>
    </FormModal>
  );
}