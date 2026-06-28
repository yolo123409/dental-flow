export interface Patient {
  id: string;

  first_name: string;

  last_name: string;

  email: string;

  phone: string;

  date_of_birth?: string;

  gender?: string;

  address?: string;

  allergies?: string;

  medical_history?: string;

  created_at: string;
}