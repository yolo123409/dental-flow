"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { toast } from "sonner";

import { Patient } from "@/types/patient";

import { getPatients } from "@/services/patients";

import PageContainer from "@/components/ui/PageContainer";

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

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true);

      const data = await getPatients();

      setPatients(data);
    } catch (error) {
      console.error("Failed to load patients:", error);

      toast.error("Unable to load patients.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();

    return patients.filter((patient) => {
      const fullName =
        `${patient.first_name} ${patient.last_name}`.toLowerCase();

      const phone = patient.phone ?? "";

      return (
        fullName.includes(query) ||
        phone.includes(query)
      );
    });
  }, [patients, search]);

  if (loading) {
    return (
      <PageContainer>
        <div className="flex h-[60vh] items-center justify-center">
          <p className="text-lg font-medium text-slate-500">
            Loading patients...
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>

      <div className="space-y-8">

        <PatientHeader
          total={patients.length}
        />

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

        <PatientGrid
          patients={filteredPatients}
        />

        <AddPatientModal
          open={showModal}
          onClose={() => setShowModal(false)}
          onSuccess={loadPatients}
        />

      </div>

    </PageContainer>
  );
}