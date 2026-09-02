"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Appointment } from "@/types/appointment";

import {
  getAppointments,
  getAppointmentCount,
  getAppointmentStats,
  deleteAppointment,
  AppointmentStats as AppointmentStatsData,
} from "@/services/appointments";

import {
  getPatientOptions,
} from "@/services/patients";

import {
  getDentistOptions,
} from "@/services/dentists";

import AppointmentHeader from "@/components/appointments/AppointmentHeader";
import AppointmentStats from "@/components/appointments/AppointmentStats";
import AppointmentGrid from "@/components/appointments/AppointmentGrid";
import AddAppointmentModal from "@/components/appointments/AddAppointmentModal";
import EditAppointmentModal from "@/components/appointments/EditAppointmentModal";

import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionGuard from "@/components/auth/PermissionGuard";

import {
  PatientOption,
  DentistOption,
} from "@/types/options";

const PAGE_SIZE = 50;

function AppointmentsPageContent() {
  const [appointments, setAppointments] =
    useState<Appointment[]>([]);

  const [patients, setPatients] =
    useState<PatientOption[]>([]);

  const [dentists, setDentists] =
    useState<DentistOption[]>([]);

  const [totalAppointments, setTotalAppointments] =
    useState(0);

  // Full-app audit fix H4: these used to be computed by filtering the
  // current 50-row page - correct for "Total" (a real COUNT), wrong for
  // every other tile (they silently reflected only whatever happened to
  // be on the visible page, changing as you paginate, never summing to
  // the total for any clinic with more than 50 appointments).
  // getAppointmentStats() already existed, already correct, and was
  // simply never wired to this page.
  const [stats, setStats] = useState<AppointmentStatsData>({
    scheduled: 0,
    completed: 0,
    cancelled: 0,
  });

  const [currentPage, setCurrentPage] =
    useState(1);

  const [loading, setLoading] =
    useState(true);

  const [deleting, setDeleting] =
    useState(false);

  const [showModal, setShowModal] =
    useState(false);

  const [showEditModal, setShowEditModal] =
    useState(false);

  const [showDeleteDialog, setShowDeleteDialog] =
    useState(false);

  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);

  useEffect(() => {
    loadLookupData();
  }, []);

  useEffect(() => {
    loadAppointments(currentPage);
  }, [currentPage]);

  async function loadLookupData() {
    try {
      const [
        patientData,
        dentistData,
        appointmentCount,
        appointmentStats,
      ] = await Promise.all([
        getPatientOptions(),
        getDentistOptions(),
        getAppointmentCount(),
        getAppointmentStats(),
      ]);

      setPatients(patientData);
      setDentists(dentistData);
      setTotalAppointments(
        appointmentCount
      );
      setStats(appointmentStats);

    } catch (error) {
      console.error(
        "Failed to load lookup data:",
        error
      );
    }
  }

  async function loadAppointments(
    page = currentPage
  ) {
    try {
      setLoading(true);

      const appointmentData =
        await getAppointments(
          page,
          PAGE_SIZE
        );

      setAppointments(
        appointmentData
      );

    } catch (error) {
      console.error(
        "Failed to load appointments:",
        error
      );
    } finally {
      setLoading(false);
    }
  }
    function handleView(
    appointment: Appointment
  ) {
    setSelectedAppointment(appointment);

    toast(
      `Viewing appointment for ${
        appointment.patients
          ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
          : "Unknown Patient"
      }`
    );
  }

  function handleEdit(
    appointment: Appointment
  ) {
    setSelectedAppointment(
      appointment
    );
    setShowEditModal(true);
  }

  function handleDelete(
    appointment: Appointment
  ) {
    setSelectedAppointment(
      appointment
    );
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (!selectedAppointment) {
      return;
    }

    try {
      setDeleting(true);

      await deleteAppointment(
        selectedAppointment.id
      );

      await loadLookupData();
      await loadAppointments(
        currentPage
      );

      setShowDeleteDialog(false);
      setSelectedAppointment(
        null
      );

    } catch (error) {
      console.error(error);

      toast.error(
        "Failed to delete appointment."
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <LoadingSpinner text="Loading appointments..." />
    );
  }

  const totalPages = Math.max(
    1,
    Math.ceil(
      totalAppointments /
        PAGE_SIZE
    )
  );

  return (
    <div className="space-y-8">

      <div className="flex items-center justify-between">

        <AppointmentHeader
          total={totalAppointments}
        />

        <Button
          onClick={() =>
            setShowModal(true)
          }
        >
          + Book Appointment
        </Button>

      </div>

      <AppointmentStats
        total={totalAppointments}
        scheduled={stats.scheduled}
        completed={stats.completed}
        cancelled={stats.cancelled}
      />

      {appointments.length ===
      0 ? (
        <EmptyState
          title="Your chair schedule is clear"
          description="Book the first patient visit and Dental Flow will keep every chair, clinician, and treatment in view."
          action={
            <Button
              onClick={() =>
                setShowModal(true)
              }
            >
              Book Appointment
            </Button>
          }
        />
      ) : (
        <>
          <AppointmentGrid
            appointments={
              appointments
            }
            onView={
              handleView
            }
            onEdit={
              handleEdit
            }
            onDelete={
              handleDelete
            }
          />
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">

            <div className="text-sm text-gray-600">
              Showing{" "}
              <span className="font-semibold">
                {(currentPage - 1) * PAGE_SIZE + 1}
              </span>
              {" - "}
              <span className="font-semibold">
                {Math.min(
                  currentPage * PAGE_SIZE,
                  totalAppointments
                )}
              </span>
              {" "}of{" "}
              <span className="font-semibold">
                {totalAppointments.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-3">

              <Button
                disabled={currentPage === 1}
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.max(1, page - 1)
                  )
                }
              >
                Previous
              </Button>

              <div className="text-sm font-medium">
                Page {currentPage} of {totalPages}
              </div>

              <Button
                disabled={
                  currentPage >= totalPages
                }
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.min(
                      totalPages,
                      page + 1
                    )
                  )
                }
              >
                Next
              </Button>

            </div>

          </div>

        </>
      )}

      <AddAppointmentModal
        open={showModal}
        patients={patients}
        dentists={dentists}
        onClose={() =>
          setShowModal(false)
        }
        onSuccess={async () => {
          await loadLookupData();
          await loadAppointments(currentPage);
          setShowModal(false);
        }}
      />

      <EditAppointmentModal
        open={showEditModal}
        appointment={selectedAppointment}
        patients={patients}
        dentists={dentists}
        onClose={() => {
          setShowEditModal(false);
          setSelectedAppointment(null);
        }}
        onSuccess={async () => {
          await loadLookupData();
          await loadAppointments(currentPage);
          setShowEditModal(false);
          setSelectedAppointment(null);
        }}
      />

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete Appointment"
        description={
          selectedAppointment
            ? `Are you sure you want to delete the appointment for ${
                selectedAppointment.patients
                  ? `${selectedAppointment.patients.first_name} ${selectedAppointment.patients.last_name}`
                  : "this patient"
              }? This action cannot be undone.`
            : ""
        }
        confirmText={
          deleting
            ? "Deleting..."
            : "Delete"
        }
        onCancel={() => {
          setShowDeleteDialog(false);
          setSelectedAppointment(null);
        }}
        onConfirm={confirmDelete}
      />

    </div>
  );
}

export default function AppointmentsPage() {
  return (
    <PermissionGuard permission="appointments">
      <AppointmentsPageContent />
    </PermissionGuard>
  );
}
