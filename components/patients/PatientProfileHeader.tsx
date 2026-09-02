"use client";

import { useMemo, useState } from "react";

import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";

import WhatsAppReminderButton from "@/components/appointments/WhatsAppReminderButton";
import WhatsAppReminderModal from "@/components/appointments/WhatsAppReminderModal";

import { Patient, Appointment } from "@/types";
import { localDateString } from "@/lib/dateUtils";

const REMINDER_ELIGIBLE_STATUSES: Appointment["status"][] = [
  "Scheduled",
  "Ongoing",
];

interface Props {
  patient: Patient;
  appointments: Appointment[];
}

export default function PatientProfileHeader({
  patient,
  appointments,
}: Props) {
  const [reminderOpen, setReminderOpen] = useState(false);

  const hasUpcomingAppointment = useMemo(() => {
    const today = localDateString(new Date());

    return appointments.some(
      (appointment) =>
        REMINDER_ELIGIBLE_STATUSES.includes(appointment.status) &&
        appointment.appointment_date >= today
    );
  }, [appointments]);

  return (
    <Card>

      <div className="flex items-center gap-6">

        <Avatar
          name={`${patient.first_name} ${patient.last_name}`}
          avatarUrl={null}
          size="xl"
        />

        <div className="flex-1">

          <h1 className="text-4xl font-bold">
            {patient.first_name} {patient.last_name}
          </h1>

          <p className="mt-3 text-slate-600">
            📞 {patient.phone ?? "No phone"}
          </p>

          <p>
            📧 {patient.email ?? "No email"}
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Patient ID: {patient.id}
          </p>

          <p className="mt-1 text-sm text-slate-500">
            Acquisition: {patient.acquisition_source ?? "Not Recorded"}
            {patient.acquisition_source === "Referral" && (
              <>
                {patient.referral_source && ` — ${patient.referral_source}`}
                {patient.referral_source_name && ` (${patient.referral_source_name})`}
              </>
            )}
          </p>

        </div>

        <WhatsAppReminderButton
          onClick={() => setReminderOpen(true)}
          disabled={!hasUpcomingAppointment}
          disabledReason={
            hasUpcomingAppointment
              ? undefined
              : "No upcoming appointment"
          }
        />

      </div>

      <WhatsAppReminderModal
        open={reminderOpen}
        patientId={patient.id}
        onClose={() => setReminderOpen(false)}
      />

    </Card>
  );
}