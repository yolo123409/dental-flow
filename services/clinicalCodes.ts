import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";

import {
  ClinicalCode,
  ClinicalCodeSystem,
  PatientDiagnosisCode,
  PatientProcedureCode,
  ProcedureCodeModifier,
} from "@/types/clinicalCodes";

/**
 * Thrown by every write in this module when the clinical coding tables
 * haven't been migrated in yet (see migration 0054_clinical_coding.sql).
 * Callers should catch this specifically and show a clear "coding isn't
 * set up yet" message rather than a raw Postgres/PostgREST error -
 * critically, this must never block or roll back the surrounding
 * tooth/treatment save, which always completes independently.
 */
export class ClinicalCodingUnavailableError extends Error {
  constructor() {
    super("Clinical coding is not set up yet. Ask an administrator to apply the latest update.");
    this.name = "ClinicalCodingUnavailableError";
  }
}

/**
 * Detects "the clinical_codes/patient_diagnosis_codes/... tables don't
 * exist yet" specifically (PostgREST's PGRST205, or Postgres's own
 * 42P01 if ever queried directly) - confirmed live against this
 * project's own Supabase instance before this table existed. Any other
 * error (a real constraint violation, a network failure, etc.) is not
 * swallowed here.
 */
function isCodingUnavailableError(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code;
  const message = (error as { message?: string } | null | undefined)?.message ?? "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    /schema cache|could not find the table|relation .* does not exist/i.test(message)
  );
}

/**
 * PostgREST's `.or()` filter string treats `,` and `()` as syntax, not
 * literal characters - stripping them keeps a user's free-text search
 * from ever being interpreted as filter syntax (never a SQL injection
 * risk either way, since supabase-js always parameterizes the actual
 * values; this is purely about not breaking the filter expression).
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()]/g, " ").trim();
}

/* -------------------------------------- */
/* Search (used by ClinicalCodePicker)    */
/* -------------------------------------- */

const DEFAULT_SEARCH_LIMIT = 20;

export async function searchClinicalCodes(
  codeSystem: ClinicalCodeSystem,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT
): Promise<ClinicalCode[]> {
  const term = sanitizeSearchTerm(query);
  if (!term) return [];

  try {
    const { data, error } = await supabase
      .from("clinical_codes")
      .select("*")
      .eq("code_system", codeSystem)
      .eq("active", true)
      .or(`code.ilike.%${term}%,short_description.ilike.%${term}%,long_description.ilike.%${term}%`)
      .order("code")
      .limit(limit);

    if (error) throw error;

    return (data ?? []) as ClinicalCode[];
  } catch (error) {
    if (isCodingUnavailableError(error)) {
      logError("[clinicalCodes] searchClinicalCodes: coding tables unavailable (migration not applied yet):", error);
      return [];
    }

    logError("[clinicalCodes] searchClinicalCodes failed:", error);
    throw toError(error);
  }
}

/* -------------------------------------- */
/* Diagnosis codes                        */
/* -------------------------------------- */

const DIAGNOSIS_SELECT = "*, clinical_codes ( * )";

export async function getDiagnosisCodesForTooth(
  patientId: string,
  toothNumber: number
): Promise<PatientDiagnosisCode[]> {
  try {
    const clinicId = await getCurrentClinicId();

    const { data, error } = await supabase
      .from("patient_diagnosis_codes")
      .select(DIAGNOSIS_SELECT)
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("tooth_number", toothNumber)
      .order("recorded_at", { ascending: false });

    if (error) throw error;

    return (data ?? []) as unknown as PatientDiagnosisCode[];
  } catch (error) {
    if (isCodingUnavailableError(error)) return [];

    logError("[clinicalCodes] getDiagnosisCodesForTooth failed:", error);
    throw toError(error);
  }
}

export async function addPatientDiagnosisCode(input: {
  patientId: string;
  codeId: string;
  toothNumber?: number | null;
  notes?: string | null;
}): Promise<string> {
  try {
    const [clinicId, actor] = await Promise.all([getCurrentClinicId(), getCurrentClinicUser()]);

    const { data, error } = await supabase
      .from("patient_diagnosis_codes")
      .insert({
        clinic_id: clinicId,
        patient_id: input.patientId,
        code_id: input.codeId,
        tooth_number: input.toothNumber ?? null,
        notes: input.notes ?? null,
        recorded_by: actor?.id ?? null,
      })
      .select("id")
      .single();

    if (error) throw error;

    return data.id as string;
  } catch (error) {
    if (isCodingUnavailableError(error)) throw new ClinicalCodingUnavailableError();

    logError("[clinicalCodes] addPatientDiagnosisCode failed:", error);
    throw toError(error);
  }
}

export async function removePatientDiagnosisCode(id: string): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();

    const { error } = await supabase
      .from("patient_diagnosis_codes")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

    if (error) throw error;
  } catch (error) {
    if (isCodingUnavailableError(error)) throw new ClinicalCodingUnavailableError();

    logError("[clinicalCodes] removePatientDiagnosisCode failed:", error);
    throw toError(error);
  }
}

/* -------------------------------------- */
/* Procedure codes (CDT / CPT)            */
/* -------------------------------------- */

const PROCEDURE_SELECT = "*, clinical_codes ( * ), modifiers:patient_procedure_code_modifiers ( * )";

export async function getProcedureCodesForTooth(
  patientId: string,
  toothNumber: number
): Promise<PatientProcedureCode[]> {
  try {
    const clinicId = await getCurrentClinicId();

    const { data, error } = await supabase
      .from("patient_procedure_codes")
      .select(PROCEDURE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("tooth_number", toothNumber)
      .order("recorded_at", { ascending: false });

    if (error) throw error;

    return (data ?? []) as unknown as PatientProcedureCode[];
  } catch (error) {
    if (isCodingUnavailableError(error)) return [];

    logError("[clinicalCodes] getProcedureCodesForTooth failed:", error);
    throw toError(error);
  }
}

export async function getProcedureCodesForTreatmentPlanItem(
  treatmentPlanItemId: string
): Promise<PatientProcedureCode[]> {
  try {
    const clinicId = await getCurrentClinicId();

    const { data, error } = await supabase
      .from("patient_procedure_codes")
      .select(PROCEDURE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("treatment_plan_item_id", treatmentPlanItemId)
      .order("recorded_at", { ascending: false });

    if (error) throw error;

    return (data ?? []) as unknown as PatientProcedureCode[];
  } catch (error) {
    if (isCodingUnavailableError(error)) return [];

    logError("[clinicalCodes] getProcedureCodesForTreatmentPlanItem failed:", error);
    throw toError(error);
  }
}

/**
 * Every tooth-linked diagnosis/procedure code for a patient, in two
 * batched queries (never one query per tooth) - used by the Patient
 * Timeline, which shows activity across every tooth on one page.
 */
export async function getAllToothCodesForPatient(patientId: string): Promise<{
  diagnosisByTooth: Map<number, PatientDiagnosisCode[]>;
  procedureByTooth: Map<number, PatientProcedureCode[]>;
}> {
  const empty = { diagnosisByTooth: new Map(), procedureByTooth: new Map() };

  try {
    const clinicId = await getCurrentClinicId();

    const [diagnosisResult, procedureResult] = await Promise.all([
      supabase
        .from("patient_diagnosis_codes")
        .select(DIAGNOSIS_SELECT)
        .eq("clinic_id", clinicId)
        .eq("patient_id", patientId)
        .not("tooth_number", "is", null),
      supabase
        .from("patient_procedure_codes")
        .select(PROCEDURE_SELECT)
        .eq("clinic_id", clinicId)
        .eq("patient_id", patientId)
        .not("tooth_number", "is", null),
    ]);

    if (diagnosisResult.error) throw diagnosisResult.error;
    if (procedureResult.error) throw procedureResult.error;

    const diagnosisByTooth = new Map<number, PatientDiagnosisCode[]>();
    for (const row of (diagnosisResult.data ?? []) as unknown as PatientDiagnosisCode[]) {
      if (row.tooth_number == null) continue;
      const list = diagnosisByTooth.get(row.tooth_number) ?? [];
      list.push(row);
      diagnosisByTooth.set(row.tooth_number, list);
    }

    const procedureByTooth = new Map<number, PatientProcedureCode[]>();
    for (const row of (procedureResult.data ?? []) as unknown as PatientProcedureCode[]) {
      if (row.tooth_number == null) continue;
      const list = procedureByTooth.get(row.tooth_number) ?? [];
      list.push(row);
      procedureByTooth.set(row.tooth_number, list);
    }

    return { diagnosisByTooth, procedureByTooth };
  } catch (error) {
    if (isCodingUnavailableError(error)) return empty;

    logError("[clinicalCodes] getAllToothCodesForPatient failed:", error);
    throw toError(error);
  }
}

export async function addPatientProcedureCode(input: {
  patientId: string;
  codeId: string;
  toothNumber?: number | null;
  treatmentPlanItemId?: string | null;
  notes?: string | null;
}): Promise<string> {
  try {
    const [clinicId, actor] = await Promise.all([getCurrentClinicId(), getCurrentClinicUser()]);

    const { data, error } = await supabase
      .from("patient_procedure_codes")
      .insert({
        clinic_id: clinicId,
        patient_id: input.patientId,
        code_id: input.codeId,
        tooth_number: input.toothNumber ?? null,
        treatment_plan_item_id: input.treatmentPlanItemId ?? null,
        notes: input.notes ?? null,
        recorded_by: actor?.id ?? null,
      })
      .select("id")
      .single();

    if (error) throw error;

    return data.id as string;
  } catch (error) {
    if (isCodingUnavailableError(error)) throw new ClinicalCodingUnavailableError();

    logError("[clinicalCodes] addPatientProcedureCode failed:", error);
    throw toError(error);
  }
}

/** Cascade-deletes the procedure code's modifiers too (FK on delete cascade). */
export async function removePatientProcedureCode(id: string): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();

    const { error } = await supabase
      .from("patient_procedure_codes")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

    if (error) throw error;
  } catch (error) {
    if (isCodingUnavailableError(error)) throw new ClinicalCodingUnavailableError();

    logError("[clinicalCodes] removePatientProcedureCode failed:", error);
    throw toError(error);
  }
}

/* -------------------------------------- */
/* Modifiers                              */
/* -------------------------------------- */

export async function addProcedureCodeModifier(
  procedureCodeId: string,
  modifierCode: string,
  modifierDescription?: string | null
): Promise<ProcedureCodeModifier> {
  try {
    const clinicId = await getCurrentClinicId();

    const { data, error } = await supabase
      .from("patient_procedure_code_modifiers")
      .insert({
        clinic_id: clinicId,
        procedure_code_id: procedureCodeId,
        modifier_code: modifierCode.trim(),
        modifier_description: modifierDescription?.trim() || null,
      })
      .select("*")
      .single();

    if (error) throw error;

    return data as ProcedureCodeModifier;
  } catch (error) {
    if (isCodingUnavailableError(error)) throw new ClinicalCodingUnavailableError();

    logError("[clinicalCodes] addProcedureCodeModifier failed:", error);
    throw toError(error);
  }
}

export async function removeProcedureCodeModifier(id: string): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();

    const { error } = await supabase
      .from("patient_procedure_code_modifiers")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

    if (error) throw error;
  } catch (error) {
    if (isCodingUnavailableError(error)) throw new ClinicalCodingUnavailableError();

    logError("[clinicalCodes] removeProcedureCodeModifier failed:", error);
    throw toError(error);
  }
}
