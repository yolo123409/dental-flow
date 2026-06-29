"use client";

import { Dentist } from "@/types/dentist";
import DentistCard from "./DentistCard";

interface Props {
  dentists: Dentist[];
  onEdit: (dentist: Dentist) => void;
  onDelete: (dentist: Dentist) => void;
}

export default function DentistGrid({
  dentists,
  onEdit,
  onDelete,
}: Props) {
  if (dentists.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed bg-white py-20 text-center">

        <h2 className="text-2xl font-bold">
          No Dentists Found
        </h2>

        <p className="mt-2 text-slate-500">
          Add your first dentist to get started.
        </p>

      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">

      {dentists.map((dentist) => (
        <DentistCard
          key={dentist.id}
          dentist={dentist}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}

    </div>
  );
}