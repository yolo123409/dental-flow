export type PatientGender =
  | "Male"
  | "Female"
  | "Other";

export interface Patient {
  id: string;

  first_name: string;

  last_name: string;

  phone: string;

  email: string | null;

  gender: PatientGender | null;

  date_of_birth: string | null;

  address: string | null;

  allergies: string | null;

  medical_history: string | null;

  created_at: string;
}