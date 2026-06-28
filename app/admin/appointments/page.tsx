"use client";

import { useEffect, useState } from "react";

import { Appointment } from "@/types/appointment";

import {
  getAppointments,
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

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface DentistOption {
  id: string;
  full_name: string;
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [dentists, setDentists] = useState<DentistOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);

      const [
        appointmentData,
        patientData,
        dentistData,
      ] = await Promise.all([
        getAppointments(),
        getPatientOptions(),
        getDentistOptions(),
      ]);

      setAppointments(appointmentData);
      setPatients(patientData);
      setDentists(dentistData);

    } catch (error) {
      console.error("Failed to load appointments:", error);
    } finally {
      setLoading(false);
    }
  }

  function handleView(appointment: Appointment) {
    setSelectedAppointment(appointment);

    alert(
      `Viewing appointment for ${
        appointment.patients
          ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
          : "Unknown Patient"
      }`
    );
  }

  function handleEdit(appointment: Appointment) {
    setSelectedAppointment(appointment);
    setShowEditModal(true);
  }

  function handleDelete(appointment: Appointment) {
    setSelectedAppointment(appointment);
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (!selectedAppointment) return;

    try {
      setDeleting(true);

      await deleteAppointment(selectedAppointment.id);

      await loadData();

      setShowDeleteDialog(false);
      setSelectedAppointment(null);


    } catch (error) {
      console.error(error);
      alert("Failed to delete appointment.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <LoadingSpinner text="Loading appointments..." />
    );
  }

  const scheduled = appointments.filter(
    (a) => a.status === "Scheduled"
  ).length;

  const completed = appointments.filter(
    (a) => a.status === "Completed"
  ).length;

  const cancelled = appointments.filter(
    (a) => a.status === "Cancelled"
  ).length;

  return (
    <div className="space-y-8">

      <div className="flex items-center justify-between">

        <AppointmentHeader
          total={appointments.length}
        />

        <Button
          onClick={() => setShowModal(true)}
        >
          + Book Appointment
        </Button>

      </div>

      <AppointmentStats
        total={appointments.length}
        scheduled={scheduled}
        completed={completed}
        cancelled={cancelled}
      />

      {appointments.length === 0 ? (
        <EmptyState
          title="No Appointments"
          description="Book your first appointment to get started."
          action={
            <Button
              onClick={() => setShowModal(true)}
            >
              Book Appointment
            </Button>
          }
        />
      ) : (
        <AppointmentGrid
          appointments={appointments}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      <AddAppointmentModal
        open={showModal}
        patients={patients}
        dentists={dentists}
        onClose={() => setShowModal(false)}
        onSuccess={loadData}
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
        onSuccess={loadData}
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
          deleting ? "Deleting..." : "Delete"
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