import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import {
  Supplier,
  SupplierContact,
  SupplierWithContacts,
  SupplierInput,
  SupplierContactInput,
} from "@/types/procurement";

export async function getSuppliers(
  options: { includeInactive?: boolean } = {}
): Promise<Supplier[]> {
  const clinicId = await getCurrentClinicId();

  let query = supabase
    .from("clinic_suppliers")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("name", { ascending: true });

  if (!options.includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    logError("[suppliers] getSuppliers failed:", error);

    throw toError(error);
  }

  return (data ?? []) as Supplier[];
}

export async function getSupplier(
  id: string
): Promise<SupplierWithContacts> {
  await assertPermission("procurement");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_suppliers")
    .select("*, clinic_supplier_contacts(*)")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    logError("[suppliers] getSupplier failed:", error);

    throw toError(error);
  }

  return data as SupplierWithContacts;
}

export async function createSupplier(
  input: SupplierInput
): Promise<Supplier> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_suppliers")
    .insert({
      clinic_id: clinicId,
      name: input.name,
      address: input.address ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    logError("[suppliers] createSupplier failed:", error);

    throw toError(error);
  }

  return data as Supplier;
}

export async function updateSupplier(
  id: string,
  input: SupplierInput
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_suppliers")
    .update({
      name: input.name,
      address: input.address ?? null,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[suppliers] updateSupplier failed:", error);

    throw toError(error);
  }
}

export async function archiveSupplier(id: string): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_suppliers")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[suppliers] archiveSupplier failed:", error);

    throw toError(error);
  }
}

export async function reactivateSupplier(id: string): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_suppliers")
    .update({ active: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[suppliers] reactivateSupplier failed:", error);

    throw toError(error);
  }
}

export async function createSupplierContact(
  supplierId: string,
  input: SupplierContactInput
): Promise<SupplierContact> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_supplier_contacts")
    .insert({
      supplier_id: supplierId,
      clinic_id: clinicId,
      name: input.name,
      job_title: input.job_title ?? null,
      department: input.department ?? null,
      phone: input.phone ?? null,
      whatsapp_number: input.whatsapp_number ?? null,
      email: input.email ?? null,
      is_primary: input.is_primary ?? false,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    logError("[suppliers] createSupplierContact failed:", error);

    throw toError(error);
  }

  return data as SupplierContact;
}

export async function updateSupplierContact(
  id: string,
  input: SupplierContactInput
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_supplier_contacts")
    .update({
      name: input.name,
      job_title: input.job_title ?? null,
      department: input.department ?? null,
      phone: input.phone ?? null,
      whatsapp_number: input.whatsapp_number ?? null,
      email: input.email ?? null,
      is_primary: input.is_primary ?? false,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[suppliers] updateSupplierContact failed:", error);

    throw toError(error);
  }
}

export async function archiveSupplierContact(id: string): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_supplier_contacts")
    .update({
      active: false,
      is_primary: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[suppliers] archiveSupplierContact failed:", error);

    throw toError(error);
  }
}

/**
 * Switches the primary contact for a supplier. Unsets any current
 * primary first - the DB's partial unique index (supplier_id where
 * is_primary and active) would otherwise reject having two primaries
 * even momentarily within the same transaction-less pair of calls, so
 * order matters here (unset, then set) exactly as it does for
 * updateClinicInsuranceProviders' insert-before-delete ordering.
 */
export async function setPrimaryContact(
  supplierId: string,
  contactId: string
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error: unsetError } = await supabase
    .from("clinic_supplier_contacts")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("supplier_id", supplierId)
    .eq("clinic_id", clinicId)
    .eq("is_primary", true);

  if (unsetError) {
    logError(
      "[suppliers] setPrimaryContact (unset current) failed:",
      unsetError
    );

    throw toError(unsetError);
  }

  const { error: setError } = await supabase
    .from("clinic_supplier_contacts")
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("clinic_id", clinicId);

  if (setError) {
    logError("[suppliers] setPrimaryContact (set new) failed:", setError);

    throw toError(setError);
  }
}
