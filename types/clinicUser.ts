export interface ClinicUser {
  id: string;

  clinic_id: string;

  full_name: string;

  email: string;

  phone?: string;

  role: string;

  status: string;

  created_at?: string;

  updated_at?: string;

  last_login?: string | null;

  avatar_url?: string | null;
}