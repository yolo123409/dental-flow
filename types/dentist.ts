export interface Dentist {
  id: string;

  full_name: string;

  specialty?: string;

  email?: string;

  phone?: string;

  active: boolean;

  created_at: string;

  appointments_today?: number;

  patients_seen?: number;

  revenue?: number;
}