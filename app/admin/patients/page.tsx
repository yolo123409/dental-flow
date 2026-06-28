"use client";

import { useEffect, useState } from "react";

import { Patient } from "@/types/patient";
import { getPatients } from "@/services/patients";

import PatientHeader from "@/components/patients/PatientHeader";
import PatientStats from "@/components/patients/PatientStats";
import PatientSearch from "@/components/patients/PatientSearch";
import PatientGrid from "@/components/patients/PatientGrid";
import AddPatientModal from "@/components/patients/AddPatientModal";

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadPatients();
  }, []);

  async function loadPatients() {
    setLoading(true);

    const data = await getPatients();

    setPatients(data);
    setLoading(false);
  }

  const filteredPatients = patients.filter((patient) => {
    const fullName =
      `${patient.first_name} ${patient.last_name}`.toLowerCase();

    return (
      fullName.includes(search.toLowerCase()) ||
      patient.phone.includes(search)
    );
  });

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center text-lg font-medium">
        Loading patients...
      </div>
    );
  }

  return (
    <div className="space-y-8">

      <PatientHeader total={patients.length} />

      <PatientStats />

      <div className="flex justify-end">
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
        >
          + Add Patient
        </button>
      </div>

      <PatientSearch
        value={search}
        onChange={setSearch}
      />

      <PatientGrid patients={filteredPatients} />

      <AddPatientModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={loadPatients}
      />

    </div>
  );
}