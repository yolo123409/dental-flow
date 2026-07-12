import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";

const BUCKET = "patient-files";

export interface ToothFile {
  id: string;

  clinic_id: string;

  patient_id: string;

  tooth_number: number;

  folder_id: string;

  file_name: string;

  file_url: string;

  file_size: number | null;

  mime_type: string | null;

  uploaded_at: string;

  uploaded_by: string | null;

  thumbnailUrl?: string;
}

function extension(
  filename: string
) {
  const parts =
    filename.split(".");

  return parts.length > 1
    ? parts.pop()!
    : "";
}

export function createStoragePath(
  patientId: string,
  toothNumber: number,
  folderId: string,
  filename: string
) {
  return `${patientId}/teeth/${toothNumber}/${folderId}/${crypto.randomUUID()}.${
    extension(filename)
  }`;
}

/* -------------------------------------- */
/* Get Files                              */
/* -------------------------------------- */

export async function getFiles(
  folderId: string
): Promise<ToothFile[]> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patient_tooth_files")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("folder_id", folderId)
      .order("uploaded_at", {
        ascending: false,
      });

  if (error) throw error;

  const files =
    (data ??
      []) as ToothFile[];

  await Promise.all(
    files.map(
      async (file) => {
        if (
          file.mime_type?.startsWith(
            "image/"
          )
        ) {
          try {
            file.thumbnailUrl =
              await getSignedUrl(
                file.file_url
              );
          } catch {
            file.thumbnailUrl =
              undefined;
          }
        }
      }
    )
  );

  return files;
}

/* -------------------------------------- */
/* Upload File                            */
/* -------------------------------------- */

export async function uploadFile(
  patientId: string,
  toothNumber: number,
  folderId: string,
  file: File,
  uploadedBy?: string
): Promise<ToothFile> {
  const clinicId =
    await getCurrentClinicId();

  const storagePath =
    createStoragePath(
      patientId,
      toothNumber,
      folderId,
      file.name
    );

  const {
    error: uploadError,
  } = await supabase.storage
    .from(BUCKET)
    .upload(
      storagePath,
      file
    );

  if (uploadError) {
    throw uploadError;
  }

  const {
    data,
    error,
  } = await supabase
    .from("patient_tooth_files")
    .insert({
      clinic_id:
        clinicId,

      patient_id:
        patientId,

      tooth_number:
        toothNumber,

      folder_id:
        folderId,

      file_name:
        file.name,

      file_url:
        storagePath,

      file_size:
        file.size,

      mime_type:
        file.type,

      uploaded_by:
        uploadedBy ??
        null,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage
      .from(BUCKET)
      .remove([
        storagePath,
      ]);

    throw error;
  }

  return data;
}

/* -------------------------------------- */
/* Signed URL                             */
/* -------------------------------------- */

export async function getSignedUrl(
  storagePath: string
): Promise<string> {
  const {
    data,
    error,
  } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      storagePath,
      3600
    );

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

/* -------------------------------------- */
/* Rename File                            */
/* -------------------------------------- */

export async function renameFile(
  fileId: string,
  newName: string
) {
  const clinicId =
    await getCurrentClinicId();

  const clean =
    newName.trim();

  if (!clean) {
    throw new Error(
      "File name is required."
    );
  }

  const { error } =
    await supabase
      .from("patient_tooth_files")
      .update({
        file_name: clean,
      })
      .eq("clinic_id", clinicId)
      .eq("id", fileId);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Delete File                            */
/* -------------------------------------- */

export async function deleteFile(
  file: ToothFile
) {
  const clinicId =
    await getCurrentClinicId();

  await supabase.storage
    .from(BUCKET)
    .remove([
      file.file_url,
    ]);

  const { error } =
    await supabase
      .from("patient_tooth_files")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", file.id);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Helpers                                */
/* -------------------------------------- */

export function isImage(
  file: ToothFile
) {
  return (
    file.mime_type?.startsWith(
      "image/"
    ) ?? false
  );
}

export function isPdf(
  file: ToothFile
) {
  return (
    file.mime_type ===
    "application/pdf"
  );
}

export function canPreview(
  file: ToothFile
) {
  return (
    isImage(file) ||
    isPdf(file)
  );
}