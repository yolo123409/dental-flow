"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import PatientNoteCard from "./PatientNoteCard";
import PatientNoteModal from "./PatientNoteModal";

import {
  getPatientNotes,
  createPatientNote,
  updatePatientNote,
  deletePatientNote,
  togglePatientNotePinned,
} from "@/services/patientNotes";

import type {
  PatientNote,
  CreatePatientNoteData,
  UpdatePatientNoteData,
} from "@/types/patientNote";

interface PatientNotesProps {
  patientId: string;
}

export default function PatientNotes({
  patientId,
}: PatientNotesProps) {
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingNote, setEditingNote] =
    useState<PatientNote | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadNotes();
  }, [patientId]);

  async function loadNotes() {
    try {
      setLoading(true);

      const data = await getPatientNotes(patientId);

      setNotes(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(
    values: CreatePatientNoteData
  ) {
    await createPatientNote(values);

    await loadNotes();

    setModalOpen(false);
  }

  async function handleUpdate(
    values: UpdatePatientNoteData
  ) {
    if (!editingNote) return;

    await updatePatientNote(
      editingNote.id,
      values
    );

    await loadNotes();

    setEditingNote(null);

    setModalOpen(false);
  }

  function handleDelete(id: string) {
    setDeleteTarget(id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);

      await deletePatientNote(deleteTarget);

      await loadNotes();

      setDeleteTarget(null);
    } catch (error) {
      console.error(error);

      toast.error("Failed to delete note.");
    } finally {
      setDeleting(false);
    }
  }

  async function handlePin(
    note: PatientNote
  ) {
    try {
      await togglePatientNotePinned(
        note.id,
        !note.is_pinned
      );

      await loadNotes();
    } catch (error) {
      console.error(error);

      toast.error("Failed to update note.");
    }
  }

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">

        <h2 className="text-xl font-semibold">
          Clinical Notes
        </h2>

        <Button
          onClick={() => {
            setEditingNote(null);
            setModalOpen(true);
          }}
        >
          Add Note
        </Button>

      </div>

      {loading ? (
        <p>Loading...</p>
      ) : notes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-gray-500">
          No clinical notes yet.
        </div>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <PatientNoteCard
              key={note.id}
              note={note}
              onEdit={() => {
                setEditingNote(note);
                setModalOpen(true);
              }}
              onDelete={() =>
                handleDelete(note.id)
              }
              onTogglePin={() =>
                handlePin(note)
              }
            />
          ))}
        </div>
      )}

      <PatientNoteModal
        open={modalOpen}
        note={editingNote}
        patientId={patientId}
        onClose={() => {
          setEditingNote(null);
          setModalOpen(false);
        }}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete clinical note"
        description="This cannot be undone."
        confirmText="Delete"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

    </div>
  );
}