import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";

export interface ToothFolder {
  id: string;

  clinic_id: string;

  patient_id: string;

  tooth_number: number;

  folder_name: string;

  created_at: string;

  created_by: string | null;

  patient_tooth_files?: {
    count: number;
    uploaded_at: string;
  }[];
}

/* -------------------------------------- */
/* Get Folders                            */
/* -------------------------------------- */

export async function getFolders(
  patientId: string,
  toothNumber: number
): Promise<ToothFolder[]> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patient_tooth_folders")
      .select(`
        *,
        patient_tooth_files(
          uploaded_at
        )
      `)
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("tooth_number", toothNumber)
      .order("folder_name");

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    (folder) => ({
      ...folder,

      patient_tooth_files:
        folder.patient_tooth_files
          ?.sort(
            (
              a: {
                uploaded_at: string;
              },
              b: {
                uploaded_at: string;
              }
            ) =>
              new Date(
                b.uploaded_at
              ).getTime() -
              new Date(
                a.uploaded_at
              ).getTime()
          ) ?? [],
    })
  );
}

/* -------------------------------------- */
/* Get Folder                             */
/* -------------------------------------- */

export async function getFolder(
  folderId: string
): Promise<ToothFolder | null> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patient_tooth_folders")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("id", folderId)
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/* -------------------------------------- */
/* Create Folder                          */
/* -------------------------------------- */

export async function createFolder(
  patientId: string,
  toothNumber: number,
  folderName: string,
  createdBy?: string
): Promise<ToothFolder> {
  const clinicId =
    await getCurrentClinicId();

  const cleanName =
    folderName.trim();

  if (!cleanName) {
    throw new Error(
      "Folder name is required."
    );
  }

  const {
    data: existing,
    error: existingError,
  } = await supabase
    .from("patient_tooth_folders")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .eq("tooth_number", toothNumber)
    .ilike(
      "folder_name",
      cleanName
    )
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    throw new Error(
      "A folder with this name already exists."
    );
  }

  const { data, error } =
    await supabase
      .from("patient_tooth_folders")
      .insert({
        clinic_id: clinicId,

        patient_id: patientId,

        tooth_number:
          toothNumber,

        folder_name:
          cleanName,

        created_by:
          createdBy ?? null,
      })
      .select()
      .single();

  if (error) {
    throw error;
  }

  return data;
}

/* -------------------------------------- */
/* Rename Folder                          */
/* -------------------------------------- */

export async function renameFolder(
  folderId: string,
  newName: string
): Promise<void> {
  const clinicId =
    await getCurrentClinicId();

  const cleanName =
    newName.trim();

  if (!cleanName) {
    throw new Error(
      "Folder name is required."
    );
  }

  const { error } =
    await supabase
      .from("patient_tooth_folders")
      .update({
        folder_name:
          cleanName,
      })
      .eq("clinic_id", clinicId)
      .eq("id", folderId);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Delete Folder                          */
/* -------------------------------------- */

export async function deleteFolder(
  folderId: string
): Promise<void> {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("patient_tooth_folders")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", folderId);

  if (error) {
    throw error;
  }
}