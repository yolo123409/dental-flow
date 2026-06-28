"use client";

import { Patient } from "@/types/patient";
import PatientCard from "./PatientCard";

interface Props {
  patients: Patient[];
}

export default function PatientGrid({
  patients,
}: Props) {
  if (patients.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-12 text-center">
        No patients found.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {patients.map((patient) => (
        <PatientCard
          key={patient.id}
          patient={patient}
        />
      ))}
    </div>
  );
}