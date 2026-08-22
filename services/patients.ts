import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { Patient } from "@/types/patient";

import { getCurrentClinicId } from "./clinic";
import { notifyPatientRegistered } from "./notifications";

export interface PatientListResult {
  rows: Patient[];
  count: number;
}

/**
 * Real server-side pagination (Production Readiness 2.0), replacing the
 * previous 2,000-row safety cap - which was an explicitly-documented
 * stopgap, not real pagination, and would have started silently
 * dropping a clinic's oldest patients past that count. Search is now
 * server-side too (first name / last name / phone, matching the same
 * fields the Patients page's client-side filter used to check), so a
 * search actually searches every patient, not just whatever page is
 * currently loaded.
 */
export async function getPatients(
  page = 1,
  pageSize = 50,
  search = ""
): Promise<PatientListResult> {
  const clinicId =
    await getCurrentClinicId();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("patients")
    .select("*", { count: "exact" })
    .eq("clinic_id", clinicId)
    .order("created_at", {
      ascending: false,
    });

  const term = search.trim();

  if (term) {
    const escaped = term.replace(/[%,]/g, "");

    query = query.or(
      `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,phone.ilike.%${escaped}%`
    );
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error(error);
    return { rows: [], count: 0 };
  }

  return { rows: (data ?? []) as Patient[], count: count ?? 0 };
}

export async function getPatientOptions() {
  const clinicId =
    await getCurrentClinicId();

  // Paged rather than a single unbounded fetch - this populates the
  // patient picker on Appointments/Calendar/Ledger/Reports/Record
  // Consumption, and a clinic with more than 1,000 patients would
  // otherwise silently be missing patients from that list with no error.
  try {
    return await fetchAllRows<{ id: string; first_name: string; last_name: string }>(
      (from, to) =>
        supabase
          .from("patients")
          .select("id, first_name, last_name")
          .eq("clinic_id", clinicId)
          .order("first_name")
          .range(from, to)
    );
  } catch (error) {
    console.error(error);
    return [];
  }
}

export async function getPatientCount() {
  const clinicId =
    await getCurrentClinicId();

  const { count, error } =
    await supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId);

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function getNewPatientsThisMonthCount(): Promise<number> {
  const clinicId =
    await getCurrentClinicId();

  const now = new Date();

  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();

  const { count, error } =
    await supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .gte("created_at", monthStart);

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function createPatient(
  patient: Omit<
    Patient,
    | "id"
    | "created_at"
    | "clinic_id"
  >
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patients")
      .insert({
        ...patient,
        clinic_id: clinicId,
      })
      .select()
      .single();

  if (error) {
    throw error;
  }

  await notifyPatientRegistered(data as Patient);

  return data as Patient;
}

export async function getPatientById(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patients")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .single();

  if (error) {
    throw error;
  }

  return data as Patient;
}

export async function updatePatient(
  id: string,
  patient: Partial<Patient>
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("patients")
      .update(patient)
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deletePatient(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("patients")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    throw error;
  }
}