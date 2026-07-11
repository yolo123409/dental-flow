export type ToothCondition =
  | "Healthy"
  | "Caries"
  | "Filling"
  | "Crown"
  | "Implant"
  | "Missing";

export interface PatientTooth {
  id: string;

  patient_id: string;

  tooth_number: number;

  condition: ToothCondition;

  diagnosis: string | null;

  treatment: string | null;

  notes: string | null;

  updated_by: string | null;

  created_at: string;

  updated_at: string;
}

export interface SavePatientTooth {
  patient_id: string;

  tooth_number: number;

  condition: ToothCondition;

  diagnosis: string | null;

  treatment: string | null;

  notes: string | null;
}