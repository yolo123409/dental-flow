"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";

type Patient = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string |null;
  gender: string | null;
  allergies: string | null;
  medical_history: string | null;
  notes: string | null;
};

type Appointment = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  treatment: string;
  status: string;
};

type PatientFile = {
  id: string;
  title: string;
  file_url: string;
  file_type: string;
};

export default function PatientProfile() {
  const { id } = useParams();

  const [patient, setPatient] = useState<Patient | null>(null);

  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const [files, setFiles] = useState<PatientFile[]>([]);

  useEffect(() => {
    loadPatient();
  }, []);

  async function loadPatient() {
    const { data } = await supabase
      .from("patients")
      .select("*")
      .eq("id", id)
      .single();

    setPatient(data);

    const { data: appointmentData } = await supabase
      .from("appointments")
      .select("*")
      .eq("patient_id", id)
      .order("appointment_date", {
        ascending: false,
      });

    setAppointments(appointmentData || []);

    const { data: fileData } = await supabase
      .from("patient_files")
      .select("*")
      .eq("patient_id", id)
      .order("created_at", {
        ascending: false,
      });

    setFiles(fileData || []);
  }

  if (!patient) {
    return (
      <main className="p-12">
        Loading...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <div className="mx-auto max-w-7xl px-8 py-12">

        <div className="rounded-2xl bg-white p-10 shadow">

          <h1 className="text-5xl font-bold">
            {patient.full_name}
          </h1>

          <p className="mt-3 text-slate-500">
            {patient.email || "No email"}
          </p>

          <p className="text-slate-500">
            {patient.phone || "No phone"}
          </p>

        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">

          <div className="rounded-2xl bg-white p-8 shadow">

            <h2 className="mb-6 text-2xl font-bold">
              Medical History
            </h2>

            <p>
              {patient.medical_history || "-"}
            </p>

            <h2 className="mt-8 mb-4 text-xl font-bold">
              Allergies
            </h2>

            <p>
              {patient.allergies || "-"}
            </p>

            <h2 className="mt-8 mb-4 text-xl font-bold">
              Notes
            </h2>

            <p>
              {patient.notes || "-"}
            </p>

          </div>

          <div className="rounded-2xl bg-white p-8 shadow lg:col-span-2">

            <h2 className="mb-6 text-2xl font-bold">
              Appointment History
            </h2>

            {appointments.length === 0 ? (

              <p>
                No appointments yet.
              </p>

            ) : (

              appointments.map((appointment) => (

                <div
                  key={appointment.id}
                  className="mb-5 rounded-xl border p-5"
                >

                  <div className="flex justify-between">

                    <strong>
                      {appointment.treatment}
                    </strong>

                    <span>
                      {appointment.status}
                    </span>

                  </div>

                  <p className="mt-2 text-slate-600">

                    {appointment.appointment_date}

                    {" • "}

                    {appointment.appointment_time}

                  </p>

                </div>

              ))

            )}

          </div>

        </div>

        <div className="mt-8 rounded-2xl bg-white p-8 shadow">

          <h2 className="mb-6 text-2xl font-bold">
            Files
          </h2>

          {files.length === 0 ? (

            <p>
              No files uploaded.
            </p>

          ) : (

            files.map((file) => (

              <a
                key={file.id}
                href={file.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 block rounded-lg border p-4 hover:bg-slate-50"
              >
                {file.title}
              </a>

            ))

          )}

        </div>

      </div>

    </main>
  );
}