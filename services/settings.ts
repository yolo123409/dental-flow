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

  // NULL = not configured yet - must never be treated as 0.
  monthly_break_even_revenue: number | null;

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

  // Every clinic gets its clinic_settings row transactionally inside the
  // create_clinic_with_admin RPC at signup - there is no RLS insert policy
  // for this table (writes only happen through that RPC, same convention
  // as staff_invitations), so a missing row here means something is
  // actually wrong rather than a normal first-load case to silently paper
  // over.
  if (!data) {
    throw new Error(
      "Clinic settings are missing for this clinic. Please contact support."
    );
  }

  return data as ClinicSettings;
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

// Kept in sync with the clinic-assets bucket's own allowed_mime_types /
// file_size_limit (supabase/migrations/0010_clinic_profile_hardening.sql) -
// this is a fast, clear client-side check; the bucket-level constraint is
// the check that actually can't be bypassed by a modified client.
export const CLINIC_LOGO_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export const CLINIC_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function uploadClinicLogo(
  file: File
) {
  if (!CLINIC_LOGO_ALLOWED_TYPES.includes(file.type)) {
    throw new Error(
      "Please upload a PNG, JPG, WEBP, or SVG image."
    );
  }

  if (file.size > CLINIC_LOGO_MAX_BYTES) {
    throw new Error(
      "Logo must be smaller than 2MB."
    );
  }

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

  // The storage path is stable across re-uploads (upsert:true overwrites
  // the same object), so without a cache-busting suffix every consumer
  // (invoice header, dashboard, this settings page in another tab) would
  // keep showing a browser/CDN-cached copy of the OLD logo after "Change
  // Logo". Persisting the busted URL itself means every future reader
  // gets the fresh image, not just this session's local state.
  const bustedUrl =
    `${data.publicUrl}?v=${Date.now()}`;

  await saveClinicSettings({
    logo_url: bustedUrl,
  });

  return bustedUrl;
}

export async function removeClinicLogo() {
  const clinicId =
    await getCurrentClinicId();

  const {
    data: files,
    error: listError,
  } = await supabase.storage
    .from("clinic-assets")
    .list(clinicId);

  if (listError) {
    logError("[settings] removeClinicLogo (list) failed:", listError);

    throw toError(listError);
  }

  if (files && files.length > 0) {
    const paths = files.map(
      (file) => `${clinicId}/${file.name}`
    );

    const {
      error: removeError,
    } = await supabase.storage
      .from("clinic-assets")
      .remove(paths);

    if (removeError) {
      logError("[settings] removeClinicLogo (remove) failed:", removeError);

      throw toError(removeError);
    }
  }

  await saveClinicSettings({
    logo_url: null,
  });
}