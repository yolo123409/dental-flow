export type ToothCondition =
  | "Healthy"
  | "Caries"
  | "Filling"
  | "Crown"
  | "Implant"
  | "Missing";

export type TreatmentStatus =
  | "Planned"
  | "In Progress"
  | "Completed"
  | "Referred"
  | "Cancelled";

export interface PatientTooth {
  id: string;

  patient_id: string;

  tooth_number: number;

  condition: ToothCondition;

  diagnosis: string | null;

  treatment: string | null;

  treatment_status: TreatmentStatus | null;

  materials: string | null;

  estimated_cost: number | null;

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

  treatment_status: TreatmentStatus | null;

  materials: string | null;

  estimated_cost: number | null;

  notes: string | null;
}