import { supabase } from "@/lib/supabase";
import { getCurrentClinicId } from "./clinic";

export interface ClinicSettings {
  clinic_id: string;

  clinic_name: string;

  phone: string | null;
  email: string | null;
  website: string | null;

  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  country: string | null;

  logo_url: string | null;

  currency: string;

  invoice_prefix: string;

  created_at?: string;
  updated_at?: string;
}

export async function getClinicSettings() {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_settings")
      .select("*")
      .eq("clinic_id", clinicId)
      .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data as ClinicSettings;
  }

  const defaults = {
    clinic_id: clinicId,

    clinic_name:
      "My Dental Clinic",

    phone: null,
    email: null,
    website: null,

    address_line_1: null,
    address_line_2: null,
    city: null,
    country: null,

    logo_url: null,

    currency: "KES",

    invoice_prefix: "INV",
  };

  const {
    data: inserted,
    error: insertError,
  } = await supabase
    .from("clinic_settings")
    .insert(defaults)
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return inserted as ClinicSettings;
}

export async function saveClinicSettings(
  settings: Partial<ClinicSettings>
) {
  const clinicId =
    await getCurrentClinicId();

  const {
    data,
    error,
  } = await supabase
    .from("clinic_settings")
    .update({
      ...settings,
      updated_at:
        new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as ClinicSettings;
}

export async function uploadClinicLogo(
  file: File
) {
  const clinicId =
    await getCurrentClinicId();

  const extension =
    file.name.split(".").pop();

  const path =
    `${clinicId}/logo.${extension}`;

  const {
    error: uploadError,
  } = await supabase.storage
    .from("clinic-assets")
    .upload(path, file, {
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const {
    data,
  } = supabase.storage
    .from("clinic-assets")
    .getPublicUrl(path);

  await saveClinicSettings({
    logo_url: data.publicUrl,
  });

  return data.publicUrl;
}