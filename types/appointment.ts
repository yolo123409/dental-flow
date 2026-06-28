export interface Appointment {
  id: string;

  patient_id: string;

  dentist_id: string | null;

  appointment_date: string;

  appointment_time: string;

  treatment: string;

  notes: string;

  status: string;

  created_at: string;
}