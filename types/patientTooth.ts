export interface PatientTooth {
  id: string;

  patient_id: string;

  tooth_number: number;

  condition: string;

  diagnosis: string | null;

  treatment: string | null;

  notes: string | null;

  updated_by: string | null;

  created_at: string;

  updated_at: string;
}