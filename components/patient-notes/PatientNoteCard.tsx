import { Pin, Pencil, Trash2 } from "lucide-react";

import type { PatientNote } from "@/types/patientNote";

interface Props {
  note: PatientNote;
  onEdit: (note: PatientNote) => void;
  onDelete: (note: PatientNote) => void;
  onTogglePin: (note: PatientNote) => void;
}

export default function PatientNoteCard({
  note,
  onEdit,
  onDelete,
  onTogglePin,
}: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-gray-900">
            {note.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            {note.clinic_users && (
              <>
                <span className="font-medium text-gray-700">
                  {note.clinic_users.full_name}
                </span>

                {note.clinic_users.role && (
                  <>
                    <span>•</span>
                    <span>{note.clinic_users.role}</span>
                  </>
                )}
              </>
            )}

            <span>•</span>

            <span>
              {new Date(note.created_at).toLocaleString()}
            </span>

            {note.is_pinned && (
              <>
                <span>•</span>

                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                  Pinned
                </span>
              </>
            )}
          </div>

          <div className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-6 text-gray-700">
            {note.content}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onTogglePin(note)}
            className={`rounded-lg p-2 transition ${
              note.is_pinned
                ? "bg-yellow-100 text-yellow-600"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            title={note.is_pinned ? "Unpin note" : "Pin note"}
          >
            <Pin className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onEdit(note)}
            className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50"
            title="Edit note"
          >
            <Pencil className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onDelete(note)}
            className="rounded-lg p-2 text-red-600 transition hover:bg-red-50"
            title="Delete note"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}