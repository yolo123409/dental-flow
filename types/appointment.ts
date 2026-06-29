export interface Appointment {
  id: string;
  patient_id: string;
  dentist_id: string | null;
  appointment_date: string;
  appointment_time: string;
  duration: number;
  treatment: string;
  notes: string;
  status: string;
  created_at: string;

  patients?: {
    first_name: string;
    last_name: string;
  };

  dentists?: {
    full_name: string;
  };
}