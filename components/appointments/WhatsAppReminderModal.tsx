"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormTextarea from "@/components/ui/FormTextarea";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EditPatientModal from "@/components/patients/EditPatientModal";

import { Patient } from "@/types/patient";
import { Appointment } from "@/types/appointment";

import { getPatientById } from "@/services/patients";
import {
  getAppointmentById,
  getUpcomingAppointmentsForPatient,
} from "@/services/appointments";
import { getClinicSettings } from "@/services/settings";
import {
  getRecentReminderForAppointment,
  recordReminderOpened,
} from "@/services/whatsappReminders";

import {
  normalizeKenyanPhone,
  buildReminderMessage,
  buildWhatsAppLink,
  formatAppointmentDateTime,
} from "@/lib/whatsapp";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;

  patientId: string;

  // When provided (calendar entry point), this exact appointment is used
  // and no upcoming-appointment lookup/selection happens. When omitted
  // (patient profile entry point), the modal resolves it itself.
  appointmentId?: string;

  onClose: () => void;
}

type Step =
  | "loading"
  | "no-clinic-name"
  | "select-appointment"
  | "no-upcoming"
  | "no-phone"
  | "duplicate-warning"
  | "preview";

const DUPLICATE_WARNING_WINDOW_MINUTES = 30;

export default function WhatsAppReminderModal({
  open,
  patientId,
  appointmentId,
  onClose,
}: Props) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("loading");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [clinicName, setClinicName] = useState("");
  const [clinicPhone, setClinicPhone] = useState<string | null>(null);

  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [appointment, setAppointment] = useState<Appointment | null>(null);

  const [duplicateAge, setDuplicateAge] = useState<string | null>(null);

  const [defaultMessage, setDefaultMessage] = useState("");
  const [message, setMessage] = useState("");

  const [editPatientOpen, setEditPatientOpen] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId, appointmentId]);

  async function load() {
    setStep("loading");
    setUpcoming([]);
    setAppointment(null);
    setDuplicateAge(null);

    try {
      const [patientData, settings] = await Promise.all([
        getPatientById(patientId),
        getClinicSettings(),
      ]);

      setPatient(patientData);

      const resolvedClinicName = settings.clinic_name?.trim() ?? "";
      const resolvedClinicPhone = settings.phone?.trim() || null;

      setClinicName(resolvedClinicName);
      setClinicPhone(resolvedClinicPhone);

      if (!resolvedClinicName) {
        setStep("no-clinic-name");
        return;
      }

      if (appointmentId) {
        const target = await getAppointmentById(appointmentId);

        if (!target) {
          setStep("no-upcoming");
          return;
        }

        await prepareReminder(
          target,
          patientData,
          resolvedClinicName,
          resolvedClinicPhone
        );
        return;
      }

      const upcomingAppointments =
        await getUpcomingAppointmentsForPatient(patientId);

      setUpcoming(upcomingAppointments);

      if (upcomingAppointments.length === 0) {
        setStep("no-upcoming");
        return;
      }

      if (upcomingAppointments.length === 1) {
        await prepareReminder(
          upcomingAppointments[0],
          patientData,
          resolvedClinicName,
          resolvedClinicPhone
        );
        return;
      }

      setStep("select-appointment");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to prepare the reminder.")
      );

      onClose();
    }
  }

  async function prepareReminder(
    target: Appointment,
    patientData: Patient,
    resolvedClinicName: string,
    resolvedClinicPhone: string | null
  ) {
    setAppointment(target);

    const normalized = normalizeKenyanPhone(patientData.phone);

    if (!normalized) {
      setStep("no-phone");
      return;
    }

    const generated = buildReminderMessage({
      patientFirstName: patientData.first_name,
      clinicName: resolvedClinicName,
      treatment: target.treatment,
      appointmentDate: target.appointment_date,
      appointmentTime: target.appointment_time,
      clinicPhone: resolvedClinicPhone,
    });

    setDefaultMessage(generated);
    setMessage(generated);

    try {
      const recent = await getRecentReminderForAppointment(target.id);

      if (recent) {
        const ageMinutes =
          (Date.now() - new Date(recent.created_at).getTime()) / 60000;

        if (ageMinutes <= DUPLICATE_WARNING_WINDOW_MINUTES) {
          setDuplicateAge(formatRelativeTime(recent.created_at));
          setStep("duplicate-warning");
          return;
        }
      }
    } catch (error) {
      // The duplicate check is a courtesy warning, not a hard requirement -
      // never let it block the actual reminder flow.
      console.error(error);
    }

    setStep("preview");
  }

  function handleSelectAppointment(target: Appointment) {
    if (!patient) return;

    prepareReminder(target, patient, clinicName, clinicPhone);
  }

  async function handlePatientEdited() {
    setEditPatientOpen(false);

    await load();
  }

  async function handleOpenWhatsApp() {
    if (!patient || !appointment) return;

    const normalized = normalizeKenyanPhone(patient.phone);

    if (!normalized) {
      setStep("no-phone");
      return;
    }

    setSending(true);

    window.open(
      buildWhatsAppLink(normalized, message),
      "_blank",
      "noopener,noreferrer"
    );

    try {
      await recordReminderOpened({
        patientId: patient.id,
        appointmentId: appointment.id,
      });
    } catch (error) {
      console.error(error);

      toast.error(
        "Opened WhatsApp, but couldn't save the reminder activity record."
      );
    } finally {
      setSending(false);
      onClose();
    }
  }

  const normalizedPhone = patient
    ? normalizeKenyanPhone(patient.phone)
    : null;

  const dateTime =
    appointment &&
    formatAppointmentDateTime(
      appointment.appointment_date,
      appointment.appointment_time
    );

  return (
    <>
      <Modal
        open={open}
        title="WhatsApp Appointment Reminder"
        onClose={onClose}
        footer={
          step === "preview" ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>

              <button
                type="button"
                onClick={handleOpenWhatsApp}
                disabled={sending}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageCircle size={16} />
                {sending ? "Opening..." : "Open in WhatsApp"}
              </button>
            </>
          ) : undefined
        }
      >
        {step === "loading" && (
          <LoadingSpinner text="Preparing reminder..." />
        )}

        {step === "no-clinic-name" && (
          <div className="space-y-4 py-4 text-center">
            <p className="font-semibold text-graphite">
              Clinic name not configured
            </p>

            <p className="text-sm text-mineral">
              Add your clinic&apos;s name in Settings before sending
              WhatsApp reminders - it&apos;s used in every reminder
              message.
            </p>

            <Button
              onClick={() => {
                onClose();
                router.push("/admin/settings");
              }}
            >
              Go to Settings
            </Button>
          </div>
        )}

        {step === "no-upcoming" && (
          <div className="space-y-4 py-4 text-center">
            <p className="font-semibold text-graphite">
              No upcoming appointment
            </p>

            <p className="text-sm text-mineral">
              This patient has no upcoming appointment eligible for a
              reminder.
            </p>

            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )}

        {step === "no-phone" && (
          <div className="space-y-4 py-4 text-center">
            <p className="font-semibold text-graphite">
              No WhatsApp number available
            </p>

            <p className="text-sm text-mineral">
              Add a valid phone number to this patient&apos;s profile
              before sending an appointment reminder.
            </p>

            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>

              <Button onClick={() => setEditPatientOpen(true)}>
                Edit Patient
              </Button>
            </div>
          </div>
        )}

        {step === "duplicate-warning" && (
          <div className="space-y-4 py-4 text-center">
            <p className="font-semibold text-graphite">
              Reminder recently opened
            </p>

            <p className="text-sm text-mineral">
              A WhatsApp reminder for this appointment was opened{" "}
              {duplicateAge} ago.
            </p>

            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>

              <Button onClick={() => setStep("preview")}>
                Open Again
              </Button>
            </div>
          </div>
        )}

        {step === "select-appointment" && (
          <div className="space-y-3">
            <p className="text-sm text-mineral">
              This patient has more than one upcoming appointment. Choose
              which one to send a reminder for.
            </p>

            {upcoming.map((item) => {
              const itemDateTime = formatAppointmentDateTime(
                item.appointment_date,
                item.appointment_time
              );

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectAppointment(item)}
                  className="w-full rounded-lg border border-sea-glass bg-enamel p-4 text-left transition-colors hover:border-eucalyptus hover:bg-porcelain"
                >
                  <p className="font-semibold text-graphite">
                    {item.treatment}
                  </p>

                  <p className="mt-1 text-sm text-mineral">
                    {itemDateTime.datePart} · {itemDateTime.timePart}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {step === "preview" && patient && appointment && dateTime && (
          <div className="space-y-5">
            <div className="grid gap-4 rounded-lg border border-sea-glass bg-porcelain p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Patient
                </p>
                <p className="mt-1 font-semibold text-graphite">
                  {patient.first_name} {patient.last_name}
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Appointment
                </p>
                <p className="mt-1 font-semibold text-graphite">
                  {appointment.treatment}
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Date &amp; Time
                </p>
                <p className="mt-1 font-semibold text-graphite">
                  {dateTime.datePart} · {dateTime.timePart}
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  WhatsApp
                </p>
                <p className="mt-1 font-semibold text-graphite">
                  +{normalizedPhone}
                </p>
              </div>
            </div>

            <div>
              <FormTextarea
                label="Message Preview"
                value={message}
                rows={8}
                onChange={setMessage}
              />

              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => setMessage(defaultMessage)}
                  className="text-xs font-semibold text-eucalyptus hover:underline"
                >
                  Reset to Default
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <EditPatientModal
        open={editPatientOpen}
        patient={patient}
        onClose={() => setEditPatientOpen(false)}
        onSuccess={handlePatientEdited}
      />
    </>
  );
}
