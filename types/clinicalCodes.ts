/**
 * Clinical coding (migration 0054_clinical_coding.sql) - ICD-10-CM for
 * diagnoses, CDT (default) or CPT (secondary, explicit-only) for
 * procedures. The three systems are never interchangeable: a diagnosis
 * picker only ever searches ICD-10-CM, and a procedure picker only ever
 * searches CDT unless the caller explicitly asks for CPT. Enforced again
 * at the database layer by a trigger on each attachment table - this is
 * not just a UI convention.
 */
export type ClinicalCodeSystem = "ICD-10-CM" | "CDT" | "CPT";

export type DiagnosisCodeSystem = Extract<ClinicalCodeSystem, "ICD-10-CM">;
export type ProcedureCodeSystem = Extract<ClinicalCodeSystem, "CDT" | "CPT">;

export interface ClinicalCode {
  id: string;
  code_system: ClinicalCodeSystem;
  code: string;
  short_description: string;
  long_description: string | null;
  category: string | null;
  active: boolean;
}

export interface ProcedureCodeModifier {
  id: string;
  procedure_code_id: string;
  modifier_code: string;
  modifier_description: string | null;
  created_at: string;
}

export interface PatientDiagnosisCode {
  id: string;
  patient_id: string;
  code_id: string;
  code_system: DiagnosisCodeSystem;
  tooth_number: number | null;
  notes: string | null;
  recorded_at: string;
  clinical_codes: ClinicalCode;
}

export interface PatientProcedureCode {
  id: string;
  patient_id: string;
  code_id: string;
  code_system: ProcedureCodeSystem;
  tooth_number: number | null;
  treatment_plan_item_id: string | null;
  notes: string | null;
  recorded_at: string;
  clinical_codes: ClinicalCode;
  modifiers: ProcedureCodeModifier[];
}

/**
 * Local (unsaved-until-submit) UI state shared by every coding
 * integration point - see lib/clinicalCodingSync.ts. `key` is stable
 * within one render (a real DB id once saved, or a locally-generated
 * temp id for a pending addition); `existingId` is null until saved.
 */
export interface SyncableItem {
  key: string;
  existingId: string | null;
}

export interface AttachedModifier extends SyncableItem {
  modifierCode: string;
  modifierDescription: string | null;
}

export interface AttachedDiagnosisCode extends SyncableItem {
  code: ClinicalCode;
}

export interface AttachedProcedureCode extends SyncableItem {
  code: ClinicalCode;
  modifiers: AttachedModifier[];
}
