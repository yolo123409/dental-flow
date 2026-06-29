"use client";

import { useRouter } from "next/navigation";
import {
  Mail,
  Phone,
  Stethoscope,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react";

import { Dentist } from "@/types/dentist";

interface Props {
  dentist: Dentist;
  onEdit: (dentist: Dentist) => void;
  onDelete: (dentist: Dentist) => void;
}

export default function DentistCard({
  dentist,
  onEdit,
  onDelete,
}: Props) {
  const router = useRouter();

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm transition-all hover:shadow-lg">

      <div className="flex items-start justify-between">

        <div>

          <h2 className="text-xl font-bold">
            {dentist.full_name}
          </h2>

          <p className="mt-1 flex items-center gap-2 text-slate-500">
            <Stethoscope size={16} />
            {dentist.specialty || "General Dentist"}
          </p>

        </div>

        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            dentist.active
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {dentist.active ? "Active" : "Inactive"}
        </span>

      </div>

      <div className="mt-6 space-y-3">

        <div className="flex items-center gap-2 text-slate-600">
          <Mail size={16} />
          <span>{dentist.email || "No Email"}</span>
        </div>

        <div className="flex items-center gap-2 text-slate-600">
          <Phone size={16} />
          <span>{dentist.phone || "No Phone"}</span>
        </div>

      </div>

      <div className="mt-8 flex gap-2">

        <button
          onClick={() =>
            router.push(`/admin/dentists/${dentist.id}`)
          }
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-slate-100"
        >
          <Eye size={16} />
          View
        </button>

        <button
          onClick={() => onEdit(dentist)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          <Pencil size={16} />
          Edit
        </button>

        <button
          onClick={() => onDelete(dentist)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
        >
          <Trash2 size={16} />
          Delete
        </button>

      </div>

    </div>
  );
}