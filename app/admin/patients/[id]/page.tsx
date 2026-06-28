"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { Patient } from "@/types/patient";
import {
  getPatientById,
  deletePatient,
} from "@/services/patients";

import EditPatientModal from "@/components/patients/EditPatientModal";

export default function PatientProfile() {
  const params = useParams();

  const router = useRouter();

  const patientId = String(params.id ?? "");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);

  async function loadPatient() {
    if (!patientId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const data = await getPatientById(patientId);

      setPatient(data);
    } catch (error) {
      console.error("Failed to load patient:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPatient();
  }, [patientId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-lg font-medium">
        Loading patient...
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="flex h-screen items-center justify-center text-lg font-medium">
        Patient not found.
      </div>
    );
  }

  async function handleDelete() {
  if (!patient) return;

  const confirmed = window.confirm(
    `Delete ${patient.first_name} ${patient.last_name}?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await deletePatient(patient.id);

    alert("Patient deleted successfully.");

    router.push("/admin/patients");

  } catch (error) {
    console.error(error);

    alert("Failed to delete patient.");
  }
}

  return (
    <div className="space-y-8">

      <div className="rounded-2xl bg-white p-8 shadow">

        <h1 className="text-4xl font-bold">
          {patient.first_name} {patient.last_name}
        </h1>

        <p className="mt-2 text-slate-500">
          {patient.email || "No email"}
        </p>

        <p className="text-slate-500">
          {patient.phone}
        </p>

        <div className="mt-6 flex gap-4">

          <button
            onClick={() => setShowEditModal(true)}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Edit Patient
          </button>

          <button
  onClick={handleDelete}
  className="rounded-xl bg-red-600 px-6 py-3 font-semibold text-white transition hover:bg-red-700"
>
  Delete Patient
</button>

        </div>

      </div>

      <div className="grid gap-6 lg:grid-cols-2">

        <div className="rounded-2xl bg-white p-6 shadow">

          <h2 className="text-xl font-bold">
            Personal Information
          </h2>

          <div className="mt-6 space-y-4">

            <div>
              <p className="text-sm text-slate-500">
                Gender
              </p>

              <p className="font-medium">
                {patient.gender || "Not specified"}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-500">
                Date of Birth
              </p>

              <p className="font-medium">
                {patient.date_of_birth || "Not specified"}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-500">
                Address
              </p>

              <p className="font-medium">
                {patient.address || "Not specified"}
              </p>
            </div>

          </div>

        </div>

        <div className="rounded-2xl bg-white p-6 shadow">

          <h2 className="text-xl font-bold">
            Medical Information
          </h2>

          <div className="mt-6 space-y-4">

            <div>
              <p className="text-sm text-slate-500">
                Allergies
              </p>

              <p className="font-medium">
                {patient.allergies || "None"}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-500">
                Medical History
              </p>

              <p className="font-medium">
                {patient.medical_history || "None"}
              </p>
            </div>

          </div>

        </div>

      </div>

      <EditPatientModal
        open={showEditModal}
        patient={patient}
        onClose={() => setShowEditModal(false)}
        onSuccess={loadPatient}
      />

    </div>
  );
}