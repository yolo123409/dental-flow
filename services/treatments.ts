import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";

export interface ClinicTreatment {
  id: string;

  clinic_id: string;

  name: string;

  category: string;

  default_price: number;

  created_at: string;

  updated_at: string;
}

/* -------------------------------------- */
/* Get Treatments                         */
/* -------------------------------------- */

export async function getTreatments(): Promise<
  ClinicTreatment[]
> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_treatments")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("category")
      .order("name");

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ) as ClinicTreatment[];
}

/* -------------------------------------- */
/* Create Treatment                       */
/* -------------------------------------- */

export async function createTreatment(
  name: string,
  category: string,
  defaultPrice: number
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_treatments")
      .insert({
  clinic_id: clinicId,

  name: name.trim(),

  category: category.trim(),

  default_price: defaultPrice,

  active: true,
})
      .select()
      .single();

  if (error) {
    throw error;
  }

  return data as ClinicTreatment;
}

/* -------------------------------------- */
/* Update Treatment                       */
/* -------------------------------------- */

export async function updateTreatment(
  id: string,
  name: string,
  category: string,
  defaultPrice: number
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("clinic_treatments")
      .update({
        name: name.trim(),

        category:
          category.trim(),

        default_price:
          defaultPrice,

        updated_at:
          new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Delete Treatment                       */
/* -------------------------------------- */

export async function deleteTreatment(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("clinic_treatments")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Get One Treatment                      */
/* -------------------------------------- */

export async function getTreatment(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_treatments")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .single();

  if (error) {
  console.error("Treatments error:", error);
  throw new Error(error.message);
}

  return data as ClinicTreatment;
}

/* -------------------------------------- */
/* Search Treatments                      */
/* -------------------------------------- */

export async function searchTreatments() {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_treatments")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("name");

  if (error) {
    throw error;
  }

  return data ?? [];
}