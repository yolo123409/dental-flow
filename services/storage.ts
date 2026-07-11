import { supabase } from "@/lib/supabase";

export async function uploadPatientFile(
  patientId: string,
  file: File
) {
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
  const { data, error } = await supabase
    .from("attachments")
    .insert({
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
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}