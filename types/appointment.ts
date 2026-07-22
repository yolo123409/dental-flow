export type AppointmentStatus =
  | "Scheduled"
  | "Ongoing"
  | "Completed"
  | "Cancelled";

export interface Appointment {
  id: string;

  patient_id: string;

  appointment_date: string;

  appointment_time: string;

  duration: number | null;

  treatment: string;

  notes: string | null;

  status: AppointmentStatus;

  dentist_id: string | null;

  dentists?: {
    full_name: string;
  } | null;

  patients?: {
    first_name: string;
    last_name: string;
  } | null;
}
