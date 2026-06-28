"use client";

import { Patient } from "@/types/patient";
import Link from "next/link";

interface Props {
  patient: Patient;
}

export default function PatientCard({
  patient,
}: Props) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-lg">

      <div className="flex items-center justify-between">

        <div>

          <h2 className="text-xl font-bold">
            {patient.first_name} {patient.last_name}
          </h2>

          <p className="mt-2 text-slate-500">
            📞 {patient.phone}
          </p>

          <p className="text-slate-500">
            📧 {patient.email}
          </p>

        </div>

      </div>
      
      <Link
  href={`/admin/patients/${patient.id}`}
  className="mt-6 block rounded-xl bg-blue-600 py-3 text-center font-semibold text-white hover:bg-blue-700"
>
  View Profile
</Link>

    </div>
  );
}