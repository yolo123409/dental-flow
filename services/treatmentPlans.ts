import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";
import { createInvoice, ChargeSelection } from "./billing";
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
} from "@/types/treatmentPlan";

/* -------------------------------------- */
/* Get Treatment Plans (for a patient)     */
/* -------------------------------------- */

export async function getTreatmentPlans(
  patientId: string
): Promise<TreatmentPlanWithItems[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("treatment_plans")
    .select(`
      *,
      treatment_plan_items (
        *
      )
    `)
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
    .select(`
      *,
      treatment_plan_items (
        *
      )
    `)
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
/* Create Treatment Item                  */
/* -------------------------------------- */

export async function createTreatmentItem(
  planId: string,
  input: SaveTreatmentItemInput
): Promise<TreatmentPlanItem> {
  const clinicId = await getCurrentClinicId();

  const { count } = await supabase
    .from("treatment_plan_items")
    .select("*", { count: "exact", head: true })
    .eq("treatment_plan_id", planId);

  const { data, error } = await supabase
    .from("treatment_plan_items")
    .insert({
      clinic_id: clinicId,
      treatment_plan_id: planId,
      procedure: input.procedure.trim(),
      tooth_number: input.tooth_number,
      estimated_price: input.estimated_price,
      quantity: input.quantity,
      notes: input.notes?.trim() || null,
      priority: input.priority,
      status: input.status,
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  await touchPlan(planId, clinicId);

  return data as TreatmentPlanItem;
}

/* -------------------------------------- */
/* Update Treatment Item                  */
/* -------------------------------------- */

export async function updateTreatmentItem(
  itemId: string,
  input: Partial<SaveTreatmentItemInput>
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
      ...(input.tooth_number !== undefined && {
        tooth_number: input.tooth_number,
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

  const item = data as TreatmentPlanItem;

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
/* Delete Treatment Item                  */
/* -------------------------------------- */

export async function deleteTreatmentItem(
  itemId: string,
  planId: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();

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
/* Billing integration                    */
/* -------------------------------------- */

export type InvoiceScope = "all" | "completed" | "selected";

/**
 * Turns treatment plan items into billable clinic_charges (skipping any
 * item already linked to a charge, so nothing is ever billed twice), then
 * hands off to services/billing.ts#createInvoice - the same function the
 * Billing page itself uses - rather than duplicating invoice creation.
 */
export async function billTreatmentPlanItems(
  plan: TreatmentPlanWithItems,
  scope: InvoiceScope,
  selectedItemIds: string[] = [],
  discount = 0,
  notes?: string
) {
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

  const unbilled = items.filter(
    (item) => !item.charge_id
  );

  if (unbilled.length === 0) {
    throw new Error(
      "The selected procedures have already been invoiced."
    );
  }

  const charges: ChargeSelection[] = [];

  for (const item of unbilled) {
    const { data: charge, error } = await supabase
      .from("clinic_charges")
      .insert({
        clinic_id: clinicId,
        patient_id: plan.patient_id,
        tooth_number: item.tooth_number,
        treatment_name: item.procedure,
        amount:
          Number(item.estimated_price) * item.quantity,
        status: "Pending",
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await supabase
      .from("treatment_plan_items")
      .update({ charge_id: charge.id })
      .eq("clinic_id", clinicId)
      .eq("id", item.id);

    charges.push({
      id: charge.id,
      treatment_name: charge.treatment_name,
      amount: charge.amount,
    });
  }

  return createInvoice(
    plan.patient_id,
    charges,
    discount,
    notes
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
