import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";

const ALLOWED_PATIENT_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

export async function uploadPatientFile(
  patientId: string,
  file: File
) {
  if (!ALLOWED_PATIENT_FILE_TYPES.includes(file.type)) {
    throw new Error("Please upload a PNG, JPG, WEBP, or PDF file.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File must be smaller than 10MB.");
  }

  const extension = file.name.split(".").pop();

  const fileName =
    `${crypto.randomUUID()}.${extension}`;

  const filePath =
    `${patientId}/${fileName}`;

  const { error } = await supabase.storage
    .from("patient-files")
    .upload(filePath, file);

  if (error) {
    throw error;
  }

  return filePath;
}

export async function saveAttachment(
  patientId: string,
  filePath: string,
  file: File
) {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      title: file.name,
      file_url: filePath,
      file_type: file.type,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getPatientFiles(
  patientId: string
) {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}