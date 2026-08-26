import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";
import { createInvoice, ChargeSelection } from "./billing";
import { assertPermission } from "./authorization";
import { assertValidToothNumbers } from "./treatmentTeeth";
import {
  notifyTreatmentPlanCreated,
  notifyTreatmentCompleted,
} from "./notifications";

import {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentPlanWithItems,
  TreatmentPlanTotals,
  SaveTreatmentPlanInput,
  SaveTreatmentItemInput,
  CreateTreatmentInput,
} from "@/types/treatmentPlan";

// Nests treatment_teeth (migration 0072) under each item so a plan's
// grouped (multi-tooth) treatments can be displayed without an N+1 query
// per item - the same two-level embed shape services/billing.ts#getInvoice
// already uses for clinic_payments/insurance_providers.
//
// Phase H: also nests the linked charge's own status via charge_id (a
// to-one embed, so PostgREST returns an object or null, not an array -
// unlike treatment_teeth). Before Phase H, item.charge_id being set
// always meant "already invoiced" (a charge only ever came into
// existence right before billTreatmentPlanItems() invoiced it). Since
// every billable Treatment now gets a charge immediately on creation
// while still Pending, UI code that needs to know "is this ACTUALLY
// invoiced" must read the charge's real status here, not just whether
// charge_id is set - see TreatmentItemRow's Billed badge,
// TreatmentPlanDetail's Invoiced stat, and TreatmentItemModal's
// teethLocked check, all updated to use this.
//
// clinic_charges!treatment_plan_items_charge_id_fkey - migration 0079
// added a SECOND foreign key between these two tables
// (clinic_charges.treatment_plan_item_id -> treatment_plan_items.id, the
// reverse direction), so PostgREST can no longer infer which
// relationship "clinic_charges(...)" alone means (PGRST201, confirmed
// live) - the explicit constraint name picks the original charge_id ->
// clinic_charges.id relationship, not the new reverse one.
const TREATMENT_PLAN_ITEMS_SELECT = `
  treatment_plan_items (
    *,
    treatment_teeth (
      tooth_number
    ),
    clinic_charges!treatment_plan_items_charge_id_fkey (
      status
    )
  )
`;

/* -------------------------------------- */
/* Get Treatment Plans (for a patient)     */
/* -------------------------------------- */

export async function getTreatmentPlans(
  patientId: string
): Promise<TreatmentPlanWithItems[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("treatment_plans")
    .select(`*, ${TREATMENT_PLAN_ITEMS_SELECT}`)
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as TreatmentPlanWithItems[];
}

/* -------------------------------------- */
/* Get One Treatment Plan                 */
/* -------------------------------------- */

export async function getTreatmentPlan(
  planId: string
): Promise<TreatmentPlanWithItems> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("treatment_plans")
    .select(`*, ${TREATMENT_PLAN_ITEMS_SELECT}`)
    .eq("clinic_id", clinicId)
    .eq("id", planId)
    .single();

  if (error) {
    throw error;
  }

  const plan = data as TreatmentPlanWithItems;

  plan.treatment_plan_items = [
    ...plan.treatment_plan_items,
  ].sort((a, b) => a.sort_order - b.sort_order);

  return plan;
}

/* -------------------------------------- */
/* Create Treatment Plan                  */
/* -------------------------------------- */

export async function createTreatmentPlan(
  input: SaveTreatmentPlanInput
): Promise<TreatmentPlan> {
  const clinicId = await getCurrentClinicId();

  const clinicUser = await getCurrentClinicUser();

  const { data, error } = await supabase
    .from("treatment_plans")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patient_id,
      created_by: clinicUser?.id ?? null,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      status: input.status,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  const plan = data as TreatmentPlan;

  await notifyTreatmentPlanCreated(plan);

  return plan;
}

/* -------------------------------------- */
/* Update Treatment Plan                  */
/* -------------------------------------- */

export async function updateTreatmentPlan(
  planId: string,
  input: Partial<SaveTreatmentPlanInput>
): Promise<TreatmentPlan> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("treatment_plans")
    .update({
      ...(input.title !== undefined && {
        title: input.title.trim(),
      }),
      ...(input.notes !== undefined && {
        notes: input.notes?.trim() || null,
      }),
      ...(input.status !== undefined && {
        status: input.status,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("id", planId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as TreatmentPlan;
}

/* -------------------------------------- */
/* Delete Treatment Plan                  */
/* -------------------------------------- */

export async function deleteTreatmentPlan(
  planId: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("treatment_plans")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", planId);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Create Treatment (canonical)           */
/* -------------------------------------- */

/**
 * Phase D: the ONE canonical Treatment creation path. Every entry point -
 * the odontogram's multi-tooth selection (BulkTreatmentModal), the
 * Treatment Plan tab's "+ Add Treatment" (TreatmentItemModal), and the
 * legacy single-tooth "+ Add to Treatment Plan" flow - builds a
 * CreateTreatmentInput and calls this, rather than each maintaining its
 * own persistence logic. Always goes through the create_treatment_with_teeth
 * RPC (0073, generalized by 0076 to also accept zero teeth) as a single
 * atomic database operation - never a client-side loop of separate
 * inserts - so a Treatment can never end up partially associated with
 * only some of its teeth, regardless of whether it has 0, 1, or many.
 *
 * quantity is derived from tooth_numbers.length whenever there IS at
 * least one tooth (the established per-tooth-price rule from Phase C:
 * estimated_price stays a genuine per-tooth price, so quantity * price
 * already gives the right total everywhere - calculatePlanTotals,
 * billTreatmentPlanItems, invoice line items - with no new billing
 * logic). input.quantity is used as-is only for a genuinely tooth-less
 * Treatment (a consultation, a general exam, etc.), where it is
 * independently meaningful and not derivable from any tooth count.
 */
export async function createTreatment(
  input: CreateTreatmentInput
): Promise<TreatmentPlanItem> {
  const procedure = input.procedure.trim();

  if (!procedure) {
    throw new Error("Please choose a treatment.");
  }

  if (input.tooth_numbers.length > 0) {
    assertValidToothNumbers(input.tooth_numbers);
  }

  const quantity =
    input.tooth_numbers.length > 0
      ? input.tooth_numbers.length
      : Math.max(1, input.quantity);

  const { data, error } = await supabase.rpc(
    "create_treatment_with_teeth",
    {
      p_treatment_plan_id: input.treatment_plan_id,
      p_procedure: procedure,
      p_tooth_numbers: input.tooth_numbers,
      p_estimated_price: input.estimated_price,
      p_quantity: quantity,
      p_notes: input.notes?.trim() || null,
      p_priority: input.priority,
      p_status: input.status,
    }
  );

  if (error) {
    throw error;
  }

  await touchPlan(input.treatment_plan_id, await getCurrentClinicId());

  return data as TreatmentPlanItem;
}

/* -------------------------------------- */
/* Update Treatment Item                  */
/* -------------------------------------- */

/**
 * Scalar-field-only update (procedure/price/quantity/notes/priority/
 * status). Tooth associations are deliberately NOT part of this input -
 * they go exclusively through updateTreatmentTeeth() below, which is
 * atomic and enforces the billing-safety rule (section 12: an already-
 * invoiced Treatment's teeth are frozen). Keeping the two separate means
 * editing a Treatment's price/notes/status never has to reason about
 * teeth at all, and never accidentally bypasses that guard.
 */
export async function updateTreatmentItem(
  itemId: string,
  input: Partial<Omit<SaveTreatmentItemInput, "tooth_numbers">>
): Promise<TreatmentPlanItem> {
  const clinicId = await getCurrentClinicId();

  const { data: existing } = await supabase
    .from("treatment_plan_items")
    .select("status")
    .eq("clinic_id", clinicId)
    .eq("id", itemId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("treatment_plan_items")
    .update({
      ...(input.procedure !== undefined && {
        procedure: input.procedure.trim(),
      }),
      ...(input.estimated_price !== undefined && {
        estimated_price: input.estimated_price,
      }),
      ...(input.quantity !== undefined && {
        quantity: input.quantity,
      }),
      ...(input.notes !== undefined && {
        notes: input.notes?.trim() || null,
      }),
      ...(input.priority !== undefined && {
        priority: input.priority,
      }),
      ...(input.status !== undefined && {
        status: input.status,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("id", itemId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  let item = data as TreatmentPlanItem;

  // Phase H: a price/quantity/name change on an uninvoiced Treatment
  // must keep its Pending charge in sync (section 10) - never touches an
  // already-Invoiced charge (sync_treatment_charge_amount checks the
  // charge's own status, see migration 0080), and creates a charge for
  // the first time if the edit just made a previously-free Treatment
  // billable (price 0 -> positive). Two sequential calls, not one
  // transaction - matching this codebase's established precedent
  // (Phase A/G) for a multi-step write whose worst-case partial failure
  // is a stale-but-still-Pending charge amount, self-healing on the next
  // edit, not a lost-data scenario.
  if (
    input.estimated_price !== undefined ||
    input.quantity !== undefined ||
    input.procedure !== undefined
  ) {
    const { error: syncError } = await supabase.rpc(
      "sync_treatment_charge_amount",
      { p_treatment_plan_item_id: itemId }
    );

    if (syncError) {
      throw syncError;
    }

    const { data: refreshed } = await supabase
      .from("treatment_plan_items")
      .select()
      .eq("clinic_id", clinicId)
      .eq("id", itemId)
      .maybeSingle();

    if (refreshed) {
      item = refreshed as TreatmentPlanItem;
    }
  }

  await touchPlan(item.treatment_plan_id, clinicId);

  if (
    item.status === "Completed" &&
    existing?.status !== "Completed"
  ) {
    const { data: plan } = await supabase
      .from("treatment_plans")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .eq("id", item.treatment_plan_id)
      .maybeSingle();

    if (plan) {
      await notifyTreatmentCompleted({
        patient_id: plan.patient_id,
        procedure: item.procedure,
      });
    }
  }

  return item;
}

/* -------------------------------------- */
/* Update Treatment Teeth (edit teeth)    */
/* -------------------------------------- */

/**
 * Atomically replaces a Treatment's entire tooth set (Phase D, sections
 * 10/11) via the update_treatment_teeth RPC (0077) - a single plpgsql
 * function body, so the UI can never show "16, 17" while the database
 * still has "16, 17, 18" because a second step failed. Also keeps the
 * legacy tooth_number column and quantity in sync with the new teeth,
 * the same rules createTreatment() uses.
 *
 * Enforced server-side (defense in depth, not just this function): once
 * a Treatment has been invoiced (charge_id is set), the RPC itself
 * refuses to change its teeth and throws a clear error rather than
 * silently altering the financial meaning of an already-created charge -
 * see 0077's own comment. Callers should generally avoid even offering
 * this action for an invoiced item (see TreatmentItemModal), but the
 * guard holds regardless of what any particular UI does.
 */
export async function updateTreatmentTeeth(
  itemId: string,
  toothNumbers: number[]
): Promise<TreatmentPlanItem> {
  if (toothNumbers.length > 0) {
    assertValidToothNumbers(toothNumbers);
  }

  const { data, error } = await supabase.rpc("update_treatment_teeth", {
    p_treatment_plan_item_id: itemId,
    p_tooth_numbers: toothNumbers,
  });

  if (error) {
    throw error;
  }

  const item = data as TreatmentPlanItem;

  await touchPlan(item.treatment_plan_id, await getCurrentClinicId());

  return item;
}

/* -------------------------------------- */
/* Delete Treatment Item                  */
/* -------------------------------------- */

export async function deleteTreatmentItem(
  itemId: string,
  planId: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  // treatment_teeth rows for this item are removed automatically by the
  // ON DELETE CASCADE foreign key set up in migration 0072 - nothing
  // extra to do here.
  const { error } = await supabase
    .from("treatment_plan_items")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", itemId);

  if (error) {
    throw error;
  }

  await touchPlan(planId, clinicId);
}

/* -------------------------------------- */
/* Reorder Treatment Items                */
/* -------------------------------------- */

export async function reorderTreatmentItems(
  planId: string,
  orderedItemIds: string[]
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  await Promise.all(
    orderedItemIds.map((itemId, index) =>
      supabase
        .from("treatment_plan_items")
        .update({ sort_order: index })
        .eq("clinic_id", clinicId)
        .eq("id", itemId)
    )
  );

  await touchPlan(planId, clinicId);
}

/* -------------------------------------- */
/* Totals (single source of truth)        */
/* -------------------------------------- */

export function calculatePlanTotals(
  items: TreatmentPlanItem[]
): TreatmentPlanTotals {
  const active = items.filter(
    (item) => item.status !== "Cancelled"
  );

  const totalEstimated = active.reduce(
    (sum, item) =>
      sum + Number(item.estimated_price) * item.quantity,
    0
  );

  const completedItems = active.filter(
    (item) => item.status === "Completed"
  );

  const totalCompleted = completedItems.reduce(
    (sum, item) =>
      sum + Number(item.estimated_price) * item.quantity,
    0
  );

  return {
    totalEstimated,
    totalCompleted,
    remaining: totalEstimated - totalCompleted,
    procedureCount: active.length,
    completedCount: completedItems.length,
    progress:
      active.length === 0
        ? 0
        : Math.round(
            (completedItems.length / active.length) * 100
          ),
  };
}

/* -------------------------------------- */
/* Associated teeth (single source of truth) */
/* -------------------------------------- */

/**
 * The teeth a treatment applies to, for display. Prefers the real
 * treatment_teeth relationship (populated by createTreatment() for every
 * new record, and backfilled for pre-Phase-A records); falls back to the
 * legacy single tooth_number column for an item whose treatment_teeth
 * wasn't fetched or doesn't exist yet (any record predating the Phase D
 * unification). Always sorted, so a treatment's teeth render in a stable,
 * ascending order. Returns [] for a genuinely tooth-less Treatment.
 */
export function getItemTeeth(item: TreatmentPlanItem): number[] {
  if (item.treatment_teeth && item.treatment_teeth.length > 0) {
    return [...item.treatment_teeth]
      .map((row) => row.tooth_number)
      .sort((a, b) => a - b);
  }

  return item.tooth_number != null ? [item.tooth_number] : [];
}

/* -------------------------------------- */
/* Invoiced state (single source of truth) */
/* -------------------------------------- */

/**
 * Whether a Treatment has actually been invoiced - the single place this
 * question is answered, so a "Billed" badge, a teeth-locked check, and an
 * "Invoiced" total can never silently disagree.
 *
 * Phase H changed what item.charge_id being set means: before this
 * phase, a charge only ever came into existence right before
 * billTreatmentPlanItems() invoiced it, so charge_id alone was a
 * reliable "already invoiced" signal. Since every billable Treatment now
 * gets a charge immediately on creation (still Pending), that's no
 * longer true - this reads the linked charge's real status (nested via
 * TREATMENT_PLAN_ITEMS_SELECT's clinic_charges(status) embed) whenever
 * it's available, and only falls back to the old charge_id-only
 * heuristic for a caller that hasn't fetched the nested embed.
 */
export function isItemInvoiced(item: TreatmentPlanItem): boolean {
  if (item.clinic_charges) {
    return item.clinic_charges.status !== "Pending";
  }

  return item.charge_id != null;
}

/* -------------------------------------- */
/* Billing integration                    */
/* -------------------------------------- */

export type InvoiceScope = "all" | "completed" | "selected";

/**
 * Turns treatment plan items into billable clinic_charges, then hands off
 * to services/billing.ts#createInvoice - the same function the Billing
 * page itself uses - rather than duplicating invoice creation.
 *
 * Unchanged by Phase C: a grouped (multi-tooth) treatment already carries
 * its full total in estimated_price * quantity (price-per-tooth * teeth
 * count), so it becomes exactly one clinic_charges row / one invoice line
 * here, with tooth_number null - never one charge per tooth.
 *
 * Phase H: before this phase, item.charge_id being unset was exactly
 * "not yet billed" - charges only ever came into existence right here,
 * immediately before being invoiced. Since Phase H, EVERY billable
 * Treatment gets a Pending charge the moment it's created
 * (create_treatment_with_teeth, migration 0080) and keeps it in sync on
 * edit (sync_treatment_charge_amount) - so charge_id being set no longer
 * means "already invoiced" by itself. What actually matters is the
 * linked charge's own status: a Pending charge (whether auto-created at
 * Treatment-creation time or, for a pre-Phase-H item, created for the
 * first time right here as a fallback) is exactly what's billable now; a
 * charge already in any other status (Invoiced) is excluded, which is
 * still the same "never invoice the same item twice" guarantee section
 * 5/10/29 required, just keyed off the charge's real state instead of
 * charge_id's mere presence.
 */
export async function billTreatmentPlanItems(
  plan: TreatmentPlanWithItems,
  scope: InvoiceScope,
  selectedItemIds: string[] = [],
  discount = 0,
  notes?: string,
  paymentMethod?: string | null,
  insuranceProviderId?: string | null
) {
  // Checked here, before any clinic_charges/treatment_plan_items writes
  // happen below, rather than relying only on createInvoice()'s own
  // check at the very end - createInvoice() alone would still leave
  // behind orphaned Pending charges linked to treatment_plan_items for a
  // caller who fails the permission check right at the last step.
  await assertPermission("billing");

  const clinicId = await getCurrentClinicId();

  let items = plan.treatment_plan_items.filter(
    (item) => item.status !== "Cancelled"
  );

  if (scope === "completed") {
    items = items.filter(
      (item) => item.status === "Completed"
    );
  } else if (scope === "selected") {
    items = items.filter((item) =>
      selectedItemIds.includes(item.id)
    );
  }

  const linkedChargeIds = items
    .map((item) => item.charge_id)
    .filter((id): id is string => id != null);

  let pendingChargeIds = new Set<string>();

  if (linkedChargeIds.length > 0) {
    const { data: existingCharges, error: chargesError } = await supabase
      .from("clinic_charges")
      .select("id, status")
      .eq("clinic_id", clinicId)
      .in("id", linkedChargeIds);

    if (chargesError) {
      throw chargesError;
    }

    pendingChargeIds = new Set(
      (existingCharges ?? [])
        .filter((charge) => charge.status === "Pending")
        .map((charge) => charge.id as string)
    );
  }

  const unbilled = items.filter(
    (item) => !item.charge_id || pendingChargeIds.has(item.charge_id)
  );

  if (unbilled.length === 0) {
    throw new Error(
      "The selected treatments have already been invoiced."
    );
  }

  const charges: ChargeSelection[] = [];

  for (const item of unbilled) {
    const amount = Number(item.estimated_price) * item.quantity;
    let chargeId = item.charge_id;

    if (!chargeId) {
      // Fallback for an item with no charge at all yet (e.g. it
      // predates Phase H, or was created with price 0 and never edited
      // through a path that would have staged one) - creates it now,
      // the exact same shape sync_treatment_charge_amount uses.
      const { data: charge, error } = await supabase
        .from("clinic_charges")
        .insert({
          clinic_id: clinicId,
          patient_id: plan.patient_id,
          tooth_number: item.tooth_number,
          treatment_name: item.procedure,
          amount,
          status: "Pending",
          treatment_plan_item_id: item.id,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      chargeId = charge.id;

      await supabase
        .from("treatment_plan_items")
        .update({ charge_id: chargeId })
        .eq("clinic_id", clinicId)
        .eq("id", item.id);
    }

    if (!chargeId) {
      throw new Error(
        `Failed to resolve a charge for treatment ${item.id}.`
      );
    }

    charges.push({
      id: chargeId,
      treatment_name: item.procedure,
      amount,
    });
  }

  return createInvoice(
    plan.patient_id,
    charges,
    discount,
    notes,
    paymentMethod,
    insuranceProviderId
  );
}

/* -------------------------------------- */
/* Internal helper                        */
/* -------------------------------------- */

async function touchPlan(
  planId: string,
  clinicId: string
) {
  await supabase
    .from("treatment_plans")
    .update({ updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("id", planId);
}
