"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";

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

  async function handleDelete(id: string) {
    if (
      !confirm(
        "Delete this clinical note?"
      )
    ) {
      return;
    }

    await deletePatientNote(id);

    await loadNotes();
  }

  async function handlePin(
    note: PatientNote
  ) {
    await togglePatientNotePinned(
      note.id,
      !note.is_pinned
    );

    await loadNotes();
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

    </div>
  );
}