import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
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

  tax_enabled: boolean;
  tax_name: string;
  tax_rate: number;
  prices_include_tax: boolean;
  tax_registration_number: string | null;
  invoice_footer_tax_note: string | null;

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
    logError("[settings] getClinicSettings failed:", error);

    throw toError(error);
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

    tax_enabled: false,
    tax_name: "VAT",
    tax_rate: 0,
    prices_include_tax: false,
    tax_registration_number: null,
    invoice_footer_tax_note: null,
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
    logError(
      "[settings] Failed to insert default clinic settings:",
      insertError
    );

    throw toError(insertError);
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
    logError("[settings] saveClinicSettings failed:", error);

    throw toError(error);
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
    logError("[settings] uploadClinicLogo failed:", uploadError);

    throw toError(uploadError);
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