"use client";

import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";

interface Props {
  patient: any;
}

export default function PatientHeader({
  patient,
}: Props) {
  return (
    <Card>
      <div className="flex items-center gap-6">

        <Avatar
          name={`${patient.first_name} ${patient.last_name}`}
          size="xl"
        />

        <div className="flex-1">

          <h1 className="text-4xl font-bold">
            {patient.first_name} {patient.last_name}
          </h1>

          <p className="mt-3 text-slate-600">
            📞 {patient.phone || "No phone"}
          </p>

          <p>
            📧 {patient.email || "No email"}
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Patient ID: {patient.id}
          </p>

        </div>

      </div>
    </Card>
  );
}