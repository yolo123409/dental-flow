"use client";

import { useEffect, useState } from "react";

import Card from "@/components/ui/Card";
import { getRecentPatients } from "@/services/dashboard";

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export default function RecentPatientsWidget() {
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    loadPatients();
  }, []);

  async function loadPatients() {
    const data = await getRecentPatients();
    setPatients(data);
  }

  return (
    <Card title="Recent Patients">

      {patients.length === 0 ? (

        <p className="text-slate-500">
          No patients found.
        </p>

      ) : (

        <div className="space-y-4">

          {patients.map((patient) => (

            <div
              key={patient.id}
              className="flex items-center justify-between rounded-xl bg-slate-50 p-4"
            >

              <div>

                <p className="font-semibold">
                  {patient.first_name} {patient.last_name}
                </p>

                <p className="text-sm text-slate-500">
                  {patient.phone || "No phone"}
                </p>

              </div>

            </div>

          ))}

        </div>

      )}

    </Card>
  );
}