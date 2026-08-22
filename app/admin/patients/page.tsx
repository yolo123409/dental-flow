"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { toast } from "sonner";

import { Patient } from "@/types/patient";

import { getPatients, getPatientCount } from "@/services/patients";

import PageContainer from "@/components/ui/PageContainer";
import PermissionGuard from "@/components/auth/PermissionGuard";
import Button from "@/components/ui/Button";

import PatientHeader from "@/components/patients/PatientHeader";
import PatientStats from "@/components/patients/PatientStats";
import PatientSearch from "@/components/patients/PatientSearch";
import PatientGrid from "@/components/patients/PatientGrid";
import AddPatientModal from "@/components/patients/AddPatientModal";

const PAGE_SIZE = 50;

// Debounced so a network round trip doesn't fire on every keystroke -
// search is now server-side (Production Readiness 2.0), searching every
// patient in the clinic rather than just whatever page happened to
// already be loaded client-side.
const SEARCH_DEBOUNCE_MS = 300;

function PatientsPageContent() {
  const [patients, setPatients] = useState<Patient[]>([]);

  // Search-result count (drives the pager) - distinct from clinicTotal
  // below, which always reflects the clinic's true total regardless of
  // any active search, matching the header badge's original meaning.
  const [totalPatients, setTotalPatients] = useState(0);

  const [clinicTotal, setClinicTotal] = useState(0);

  const [currentPage, setCurrentPage] = useState(1);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [showModal, setShowModal] = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPatients = useCallback(async (page: number, searchTerm: string) => {
    try {
      setLoading(true);

      const [{ rows, count }, trueTotal] = await Promise.all([
        getPatients(page, PAGE_SIZE, searchTerm),
        getPatientCount(),
      ]);

      setPatients(rows);
      setTotalPatients(count);
      setClinicTotal(trueTotal);
    } catch (error) {
      console.error("Failed to load patients:", error);

      toast.error("Unable to load patients.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPatients(currentPage, debouncedSearch);
  }, [currentPage, debouncedSearch, loadPatients]);

  function handleSearchChange(value: string) {
    setSearch(value);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setCurrentPage(1);
      setDebouncedSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalPatients / PAGE_SIZE));

  if (loading && patients.length === 0) {
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
          total={clinicTotal}
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
          onChange={handleSearchChange}
        />

        <PatientGrid
          patients={patients}
        />

        {totalPatients > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">

            <div className="text-sm text-gray-600">
              Showing{" "}
              <span className="font-semibold">
                {(currentPage - 1) * PAGE_SIZE + 1}
              </span>
              {" - "}
              <span className="font-semibold">
                {Math.min(currentPage * PAGE_SIZE, totalPatients)}
              </span>
              {" "}of{" "}
              <span className="font-semibold">
                {totalPatients.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-3">

              <Button
                disabled={currentPage === 1}
                onClick={() =>
                  setCurrentPage((page) => Math.max(1, page - 1))
                }
              >
                Previous
              </Button>

              <div className="text-sm font-medium">
                Page {currentPage} of {totalPages}
              </div>

              <Button
                disabled={currentPage >= totalPages}
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
              >
                Next
              </Button>

            </div>

          </div>
        )}

        <AddPatientModal
          open={showModal}
          onClose={() => setShowModal(false)}
          onSuccess={() => loadPatients(currentPage, debouncedSearch)}
        />

      </div>

    </PageContainer>
  );
}

export default function PatientsPage() {
  return (
    <PermissionGuard permission="patients">
      <PatientsPageContent />
    </PermissionGuard>
  );
}
