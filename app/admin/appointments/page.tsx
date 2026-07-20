"use client";

import { useEffect, useState } from "react";

import { Appointment } from "@/types/appointment";

import {
  getAppointments,
  getAppointmentCount,
  deleteAppointment,
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

import {
  PatientOption,
  DentistOption,
} from "@/types/options";

const PAGE_SIZE = 50;

export default function AppointmentsPage() {
  const [appointments, setAppointments] =
    useState<Appointment[]>([]);

  const [patients, setPatients] =
    useState<PatientOption[]>([]);

  const [dentists, setDentists] =
    useState<DentistOption[]>([]);

  const [totalAppointments, setTotalAppointments] =
    useState(0);

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
      ] = await Promise.all([
        getPatientOptions(),
        getDentistOptions(),
        getAppointmentCount(),
      ]);

      setPatients(patientData);
      setDentists(dentistData);
      setTotalAppointments(
        appointmentCount
      );

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

    alert(
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

      alert(
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

  const scheduled =
    appointments.filter(
      (appointment) =>
        appointment.status ===
        "Scheduled"
    ).length;

  const completed =
    appointments.filter(
      (appointment) =>
        appointment.status ===
        "Completed"
    ).length;

  const cancelled =
    appointments.filter(
      (appointment) =>
        appointment.status ===
        "Cancelled"
    ).length;

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
        scheduled={scheduled}
        completed={completed}
        cancelled={cancelled}
      />

      {appointments.length ===
      0 ? (
        <EmptyState
          title="No Appointments"
          description="Book your first appointment to get started."
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