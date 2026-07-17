import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "@/services/clinic";

import type {
  PatientNote,
  CreatePatientNoteData,
  UpdatePatientNoteData,
} from "@/types/patientNote";

const NOTE_SELECT = `
  *,
  clinic_users!patient_notes_author_id_fkey (
    id,
    full_name,
    role
  )
`;

export async function getPatientNotes(
  patientId: string
): Promise<PatientNote[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("patient_notes")
    .select(NOTE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("is_pinned", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data ?? []) as PatientNote[];
}

export async function getPatientNote(
  id: string
): Promise<PatientNote | null> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("patient_notes")
    .select(NOTE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }

    throw error;
  }

  return data as PatientNote;
}

export async function createPatientNote(
  note: CreatePatientNoteData
): Promise<PatientNote> {
  const clinicId = await getCurrentClinicId();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw authError;
  }

  if (!user) {
    throw new Error("User not authenticated.");
  }

  const {
    data: clinicUser,
    error: clinicUserError,
  } = await supabase
    .from("clinic_users")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("auth_user_id", user.id)
    .single();

  if (clinicUserError) {
    throw clinicUserError;
  }

  if (!clinicUser) {
    throw new Error("Clinic user not found.");
  }

  const { data, error } = await supabase
    .from("patient_notes")
    .insert({
      clinic_id: clinicId,
      patient_id: note.patient_id,
      author_id: clinicUser.id,
      title: note.title,
      content: note.content,
      is_pinned: note.is_pinned ?? false,
    })
    .select(NOTE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as PatientNote;
}

export async function updatePatientNote(
  id: string,
  updates: UpdatePatientNoteData
): Promise<PatientNote> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("patient_notes")
    .update({
      ...updates,
    })
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .select(NOTE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as PatientNote;
}

export async function deletePatientNote(
  id: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("patient_notes")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function togglePatientNotePinned(
  id: string,
  isPinned: boolean
): Promise<PatientNote> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("patient_notes")
    .update({
      is_pinned: isPinned,
    })
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .select(NOTE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as PatientNote;
}