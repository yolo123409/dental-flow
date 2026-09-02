import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";
import { createInvoice, ChargeSelection } from "./billing";
import { assertPermission, AuthorizationError } from "./authorization";
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
      status,
      amount
    ),
    deposit_charge:clinic_charges!treatment_plan_items_deposit_charge_id_fkey (
      status,
      amount
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
  await assertPermission("treatments");

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
  await assertPermission("treatments");

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
  await assertPermission("treatments");

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
  await assertPermission("treatments");

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
  await assertPermission("treatments");

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
  await assertPermission("treatments");

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
  await assertPermission("treatments");

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
 *
 * Billing audit fix #3: once a treatment is split into a deposit +
 * balance (deposit_charge_id set), it's only fully invoiced once BOTH
 * charges are - a deposit that's already been invoiced/paid while the
 * balance is still Pending is not "invoiced" yet, it's half-billed.
 *
 * Full-app audit fix C6: checks `=== "Invoiced"` specifically, not
 * `!== "Pending"` - a cancelled treatment's charge (migration 0119) is
 * also no longer "Pending", but it must never read as "Billed" either,
 * which the old inequality check would have wrongly done.
 */
export function isItemInvoiced(item: TreatmentPlanItem): boolean {
  const mainInvoiced = item.clinic_charges
    ? item.clinic_charges.status === "Invoiced"
    : item.charge_id != null;

  if (!item.deposit_charge_id) {
    return mainInvoiced;
  }

  const depositInvoiced = item.deposit_charge
    ? item.deposit_charge.status === "Invoiced"
    : false;

  return mainInvoiced && depositInvoiced;
}

/**
 * Full-app audit fix C6: whether this item's charge (or, for a split
 * item, either half) was cancelled along with the treatment itself
 * (migration 0119's trigger) rather than ever being billed - the single
 * place this is answered, so a "Cancelled" badge agrees with
 * isItemInvoiced() rather than the two silently disagreeing about the
 * same charge.
 */
export function isItemChargeCancelled(item: TreatmentPlanItem): boolean {
  return (
    item.clinic_charges?.status === "Cancelled" ||
    item.deposit_charge?.status === "Cancelled"
  );
}

/**
 * How much of this item is still billable right now - the item's full
 * price when it isn't on a deposit plan, or just whichever of its two
 * charges (deposit/balance) are still Pending when it is. A split item's
 * still-Pending charges don't necessarily sum to estimated_price *
 * quantity (e.g. the deposit was already invoiced separately), so any
 * UI previewing "what will this invoice actually total" must use this,
 * not the item's raw price fields.
 */
export function getItemBillableAmount(item: TreatmentPlanItem): number {
  if (!item.deposit_charge_id) {
    return Number(item.estimated_price) * item.quantity;
  }

  let total = 0;

  if (item.deposit_charge && item.deposit_charge.status === "Pending") {
    total += Number(item.deposit_charge.amount);
  }

  if (item.clinic_charges && item.clinic_charges.status === "Pending") {
    total += Number(item.clinic_charges.amount);
  }

  return total;
}

/**
 * Full-app audit fix H1: how much of this item has actually been
 * invoiced, read from the real, frozen clinic_charges/deposit_charge
 * amount(s) - never the item's own editable estimated_price/quantity,
 * which TreatmentPlanDetail's "Invoiced" stat used to read directly and
 * could silently disagree with the real invoice the moment either field
 * was edited after invoicing (now also locked once invoiced, but this
 * keeps the stat correct regardless of when a row was invoiced relative
 * to that lock). Returns 0 for anything not (fully) invoiced -
 * isItemInvoiced() remains the single source of truth for that.
 */
export function getItemInvoicedAmount(item: TreatmentPlanItem): number {
  if (!isItemInvoiced(item)) {
    return 0;
  }

  if (!item.deposit_charge_id) {
    return item.clinic_charges
      ? Number(item.clinic_charges.amount)
      : Number(item.estimated_price) * item.quantity;
  }

  let total = 0;

  if (item.deposit_charge) {
    total += Number(item.deposit_charge.amount);
  }

  if (item.clinic_charges) {
    total += Number(item.clinic_charges.amount);
  }

  return total;
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

  // Billing audit fix #3: a split (deposit + balance) item has TWO
  // independently-invoiceable charges, not one - both are collected here
  // so either can be billed on its own, or together, exactly like any
  // other selectable charge.
  const linkedChargeIds = items
    .flatMap((item) => [item.charge_id, item.deposit_charge_id])
    .filter((id): id is string => id != null);

  let existingChargesById = new Map<
    string,
    { id: string; status: string; amount: number; treatment_name: string }
  >();

  if (linkedChargeIds.length > 0) {
    const { data: existingCharges, error: chargesError } = await supabase
      .from("clinic_charges")
      .select("id, status, amount, treatment_name")
      .eq("clinic_id", clinicId)
      .in("id", linkedChargeIds);

    if (chargesError) {
      throw chargesError;
    }

    existingChargesById = new Map(
      (existingCharges ?? []).map((charge) => [charge.id as string, charge])
    );
  }

  // An item counts as still billable if EITHER of its charges is Pending -
  // a split item whose deposit was already invoiced separately is still
  // very much billable for its remaining balance alone. Note the
  // asymmetry: a null main charge_id means "not created yet" (billable,
  // via the fallback below), but a null deposit_charge_id just means
  // "not on a deposit plan" - it must never count as an independent
  // Pending signal, or every non-split item would look billable twice.
  const unbilled = items.filter((item) => {
    const mainPending =
      !item.charge_id ||
      existingChargesById.get(item.charge_id)?.status === "Pending";

    const depositPending =
      item.deposit_charge_id != null &&
      existingChargesById.get(item.deposit_charge_id)?.status === "Pending";

    return mainPending || depositPending;
  });

  if (unbilled.length === 0) {
    throw new Error(
      "The selected treatments have already been invoiced."
    );
  }

  const charges: ChargeSelection[] = [];

  for (const item of unbilled) {
    // Deposit charge, if any and still Pending - its real amount/name
    // are always read fresh from the DB (never recomputed from the
    // item's price), since a deposit is a fixed, independently-set
    // figure that has nothing to do with estimated_price * quantity.
    if (item.deposit_charge_id) {
      const depositCharge = existingChargesById.get(item.deposit_charge_id);

      if (depositCharge && depositCharge.status === "Pending") {
        charges.push({
          id: depositCharge.id,
          treatment_name: depositCharge.treatment_name,
          amount: Number(depositCharge.amount),
        });
      }
    }

    let chargeId = item.charge_id;
    const existingMainCharge = chargeId
      ? existingChargesById.get(chargeId)
      : undefined;

    if (chargeId && existingMainCharge && existingMainCharge.status !== "Pending") {
      // Main/balance charge already invoiced (only the deposit, if any,
      // was still outstanding) - nothing more to add for this item.
      continue;
    }

    let amount: number;
    let treatmentName: string;

    if (!chargeId) {
      // Fallback for an item with no charge at all yet (e.g. it
      // predates Phase H, or was created with price 0 and never edited
      // through a path that would have staged one) - creates it now,
      // the exact same shape sync_treatment_charge_amount uses. Never
      // reached for a split item (a deposit can only be added to an
      // item that already has a charge), so this is always the item's
      // full price.
      amount = Number(item.estimated_price) * item.quantity;
      treatmentName = item.procedure;

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
    } else {
      // A real charge already exists - its amount is the source of
      // truth (for a split item this is the BALANCE only, already
      // reduced by add_treatment_deposit/sync_treatment_charge_amount),
      // never recomputed from the item's own price fields.
      amount = Number(
        existingMainCharge?.amount ??
          Number(item.estimated_price) * item.quantity
      );
      treatmentName = existingMainCharge?.treatment_name ?? item.procedure;
    }

    if (!chargeId) {
      throw new Error(
        `Failed to resolve a charge for treatment ${item.id}.`
      );
    }

    charges.push({
      id: chargeId,
      treatment_name: treatmentName,
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
/* Appointment-completion billing         */
/* -------------------------------------- */

/**
 * Phase B/C: marks a single treatment INSTANCE (not the whole plan, not an
 * appointment) as clinically Completed - the one and only billing trigger
 * per the audit's Issue 2 resolution. Appointment completion is a separate
 * concept entirely (services/appointments.ts#completeAppointment()); this
 * is what that function calls only after the clinician has explicitly
 * confirmed the treatment itself is actually finished.
 *
 * A thin wrapper over complete_treatment_item() (migration 0108), which
 * does the real work atomically: a `for update` lock on this treatment's
 * own row is what makes it safe for two DIFFERENT appointments to point
 * at the SAME treatment_plan_item (multi-visit) - two concurrent attempts
 * to complete the same treatment serialize on that lock, and the loser
 * gets null back here, exactly like calling this twice on an
 * already-completed item. Callers must treat null as "nothing to bill" -
 * never re-derive "did I win" any other way.
 */
export async function completeTreatmentItem(
  itemId: string
): Promise<TreatmentPlanItem | null> {
  await assertPermission("treatments");

  const { data, error } = await supabase.rpc("complete_treatment_item", {
    p_treatment_plan_item_id: itemId,
  });

  if (error) {
    throw error;
  }

  return data as TreatmentPlanItem | null;
}

/* -------------------------------------- */
/* Deposit / balance payment plans        */
/* (billing audit fix #3)                 */
/* -------------------------------------- */

/**
 * Splits a treatment's single Pending charge into a deposit + balance -
 * two independently-invoiceable clinic_charges rows reusing the exact
 * existing charge -> create_invoice_from_charges -> ledger pipeline.
 * Only possible while the treatment hasn't been invoiced yet. Gated the
 * same as any other clinical/pricing change to a treatment item
 * ("treatments" - Owner/Admin/Dentist, matching the DB's own
 * trg_guard_treatment_plan_item_role restriction).
 */
export async function addTreatmentDeposit(
  itemId: string,
  depositAmount: number
): Promise<TreatmentPlanItem> {
  await assertPermission("treatments");

  const { data, error } = await supabase.rpc("add_treatment_deposit", {
    p_treatment_plan_item_id: itemId,
    p_deposit_amount: depositAmount,
  });

  if (error) {
    throw error;
  }

  return data as TreatmentPlanItem;
}

/**
 * Undoes a deposit split, merging the deposit and balance back into one
 * charge for the treatment's full amount. Only possible while both
 * charges are still unpaid/uninvoiced.
 */
export async function removeTreatmentDeposit(
  itemId: string
): Promise<TreatmentPlanItem> {
  await assertPermission("treatments");

  const { data, error } = await supabase.rpc("remove_treatment_deposit", {
    p_treatment_plan_item_id: itemId,
  });

  if (error) {
    throw error;
  }

  return data as TreatmentPlanItem;
}

export interface CompleteAndBillResult {
  /** Null when this call lost the race, or the treatment was already
   * Completed before it ran - nothing further happened. */
  item: TreatmentPlanItem | null;
  /** True only when THIS call performed the Planned/In Progress ->
   * Completed transition (not merely observed it already Completed). */
  treatmentCompleted: boolean;
  /** True only when this call also successfully created the invoice. */
  invoiced: boolean;
  /** True when the treatment was completed but the caller lacks
   * "billing" permission - the charge is left exactly as it already was
   * (Pending), for an authorized billing user to invoice manually via
   * the existing Billing Control Center or Treatment Plan "Create
   * Invoice" action. Not an error - completion still succeeded. */
  billingDeferred: boolean;
}

/**
 * Completes a treatment instance and, in the same step, attempts to bill
 * it through the exact same canonical createInvoice() every other billing
 * path already uses - never a second accounting engine. Called only when
 * the clinician has explicitly confirmed the linked treatment is now
 * fully done (see services/appointments.ts#completeAppointment()).
 */
export async function completeAndBillTreatmentItem(
  itemId: string,
  paymentMethod?: string | null,
  insuranceProviderId?: string | null
): Promise<CompleteAndBillResult> {
  const item = await completeTreatmentItem(itemId);

  if (!item) {
    return {
      item: null,
      treatmentCompleted: false,
      invoiced: false,
      billingDeferred: false,
    };
  }

  if (!item.charge_id) {
    // Not a billable treatment (e.g. price 0) - nothing to invoice.
    return {
      item,
      treatmentCompleted: true,
      invoiced: false,
      billingDeferred: false,
    };
  }

  const { data: charge, error: chargeError } = await supabase
    .from("clinic_charges")
    .select("id, status, amount, patient_id")
    .eq("id", item.charge_id)
    .single();

  if (chargeError) {
    throw chargeError;
  }

  if (charge.status !== "Pending") {
    // Already invoiced through some other path (e.g. a manual invoice
    // created moments before this treatment was confirmed complete) -
    // the treatment-completion side still succeeded; nothing to bill.
    return {
      item,
      treatmentCompleted: true,
      invoiced: false,
      billingDeferred: false,
    };
  }

  try {
    await createInvoice(
      charge.patient_id,
      [
        {
          id: charge.id,
          treatment_name: item.procedure,
          amount: Number(charge.amount),
        },
      ],
      0,
      undefined,
      paymentMethod,
      insuranceProviderId
    );

    return {
      item,
      treatmentCompleted: true,
      invoiced: true,
      billingDeferred: false,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        item,
        treatmentCompleted: true,
        invoiced: false,
        billingDeferred: true,
      };
    }

    throw error;
  }
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
