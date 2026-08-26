import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import {
  TreatmentInstanceBillingStatus,
  TreatmentInstanceMaterialLine,
  TreatmentInstanceProfitability,
} from "@/types/treatmentInstanceProfitability";

/**
 * FIN-2.5: "how profitable was THIS specific treatment" - per-instance
 * attribution, layered entirely on top of data FIN-1/FIN-1.5/FIN-2 already
 * established. This is deliberately a read-only drill-down, not a second
 * accounting engine - the ledger (services/ledger.ts#getProfitAndLoss)
 * remains the sole canonical financial source; nothing here posts, sums
 * clinic-wide totals, or is fed back into the ledger.
 *
 * REVENUE (Phase B/C): treatment_plan_items.charge_id -> clinic_charges
 * (migrations 0006/0079/0080) is an EXACT, already-existing, already fully
 * populated (including historically) 1:1 link from a real treatment
 * instance to its billing charge - never inferred from treatment name +
 * patient + date, which the FIN-2.5 brief explicitly forbids as ambiguous.
 * clinic_charges.amount is, by construction, the exact revenue figure
 * createInvoice() copies verbatim into the resulting clinic_invoice_items
 * .total_price for that charge (services/billing.ts) - verified against
 * every existing Invoiced charge in the live database before this was
 * written (zero mismatches). Revenue is recognized only once a charge
 * reaches 'Invoiced' (matching getProfitAndLoss()'s own accrual-at-
 * invoice-creation convention, migration 0043's trg_post_invoice_ledger) -
 * a merely-Pending charge's amount is a staged estimate of what WILL be
 * billed, not yet-recognized revenue, so it reads as 0 here.
 *
 * ACTUAL MATERIAL COST (Phase D): summed from treatment_material_usage
 * (FIN-2) at its own stored historical unit_cost - never
 * clinic_inventory_items.cost_per_unit (today's live cost) and never
 * clinic_treatments.direct_cost (the manual catalog ESTIMATE, untouched
 * and unread anywhere in this file).
 *
 * Current actual treatment cost is inventory material consumption only -
 * no other actual (non-estimated) direct-cost source exists anywhere in
 * this codebase today (confirmed by inspecting every cost-bearing table
 * in Phase A: clinic_expenses is clinic-wide overhead, never attributable
 * to one treatment instance).
 */

interface RawChargeRow {
  id: string;
  status: string;
  amount: number;
  invoice_id: string | null;
}

interface RawTreatmentPlanItemRow {
  id: string;
  clinic_id: string;
  treatment_plan_id: string;
  procedure: string;
  tooth_number: number | null;
  status: string;
  created_at: string;
  treatment_teeth: { tooth_number: number }[] | null;
  clinic_charges: RawChargeRow | null;
}

const INSTANCE_SELECT = `
  id, clinic_id, treatment_plan_id, procedure, tooth_number, status, created_at,
  treatment_teeth ( tooth_number ),
  clinic_charges!treatment_plan_items_charge_id_fkey ( id, status, amount, invoice_id )
`;

interface RawInvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  amount_paid: number;
  balance: number;
}

interface RawUsageRow {
  treatment_plan_item_id: string;
  inventory_item_id: string;
  quantity: number;
  unit_cost: number;
  clinic_inventory_items: { name: string; unit: string } | null;
}

function toothNumbersFrom(row: RawTreatmentPlanItemRow): number[] {
  if (row.treatment_teeth && row.treatment_teeth.length > 0) {
    return [...row.treatment_teeth]
      .map((t) => t.tooth_number)
      .sort((a, b) => a - b);
  }

  return row.tooth_number != null ? [row.tooth_number] : [];
}

/**
 * Pure assembly - given one treatment_plan_items row plus the batched
 * lookups it needs (patient name, invoice, its own materials), builds the
 * final report row. Extracted so the single-instance and
 * batched-by-catalog-treatment paths below share one calculation.
 */
function buildInstanceProfitability(
  row: RawTreatmentPlanItemRow,
  patientId: string,
  patientName: string,
  invoicesById: Map<string, RawInvoiceRow>,
  usageByTreatmentPlanItemId: Map<string, RawUsageRow[]>
): TreatmentInstanceProfitability {
  const charge = row.clinic_charges;

  let billingStatus: TreatmentInstanceBillingStatus = "NoCharge";
  let revenue = 0;
  let invoiceId: string | null = null;
  let invoiceNumber: string | null = null;
  let invoiceStatus: string | null = null;
  let invoiceAmountPaid: number | null = null;
  let invoiceBalance: number | null = null;

  if (charge) {
    if (charge.status === "Invoiced") {
      billingStatus = "Invoiced";
      revenue = Number(charge.amount);

      if (charge.invoice_id) {
        const invoice = invoicesById.get(charge.invoice_id);

        invoiceId = charge.invoice_id;

        if (invoice) {
          invoiceNumber = invoice.invoice_number;
          invoiceStatus = invoice.status;
          invoiceAmountPaid = Number(invoice.amount_paid);
          invoiceBalance = Number(invoice.balance);
        }
      }
    } else {
      billingStatus = "Pending";
    }
  }

  const usageRows = usageByTreatmentPlanItemId.get(row.id) ?? [];

  const materials: TreatmentInstanceMaterialLine[] = usageRows.map((usage) => ({
    inventoryItemId: usage.inventory_item_id,
    name: usage.clinic_inventory_items?.name ?? "Material",
    unit: usage.clinic_inventory_items?.unit ?? "unit",
    quantity: Number(usage.quantity),
    unitCost: Number(usage.unit_cost),
    totalCost: Number(usage.quantity) * Number(usage.unit_cost),
  }));

  const actualMaterialCost = materials.reduce((sum, m) => sum + m.totalCost, 0);

  const grossProfit = revenue - actualMaterialCost;

  const grossMarginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : null;

  return {
    treatmentPlanItemId: row.id,
    patientId,
    patientName,
    procedure: row.procedure,
    toothNumbers: toothNumbersFrom(row),
    status: row.status,
    performedAt: row.created_at,
    billingStatus,
    revenue,
    invoiceId,
    invoiceNumber,
    invoiceStatus,
    invoiceAmountPaid,
    invoiceBalance,
    materials,
    actualMaterialCost,
    grossProfit,
    grossMarginPercent,
  };
}

async function loadInvoicesById(
  invoiceIds: string[]
): Promise<Map<string, RawInvoiceRow>> {
  if (invoiceIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("clinic_invoices")
    .select("id, invoice_number, status, amount_paid, balance")
    .in("id", invoiceIds);

  if (error) {
    logError("[treatmentInstanceProfitability] loadInvoicesById failed:", error);
    throw toError(error);
  }

  return new Map(((data ?? []) as RawInvoiceRow[]).map((row) => [row.id, row]));
}

async function loadUsageByTreatmentPlanItemId(
  treatmentPlanItemIds: string[]
): Promise<Map<string, RawUsageRow[]>> {
  const map = new Map<string, RawUsageRow[]>();

  if (treatmentPlanItemIds.length === 0) return map;

  const rows = (await fetchAllRows((from, to) =>
    supabase
      .from("treatment_material_usage")
      .select(
        "treatment_plan_item_id, inventory_item_id, quantity, unit_cost, clinic_inventory_items ( name, unit )"
      )
      .in("treatment_plan_item_id", treatmentPlanItemIds)
      .range(from, to)
  )) as unknown as RawUsageRow[];

  for (const row of rows) {
    const existing = map.get(row.treatment_plan_item_id) ?? [];
    existing.push(row);
    map.set(row.treatment_plan_item_id, existing);
  }

  return map;
}

async function loadPatientNames(
  patientIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  if (patientIds.length === 0) return map;

  const { data, error } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .in("id", patientIds);

  if (error) {
    logError("[treatmentInstanceProfitability] loadPatientNames failed:", error);
    throw toError(error);
  }

  for (const row of (data ?? []) as { id: string; first_name: string; last_name: string | null }[]) {
    map.set(row.id, [row.first_name, row.last_name].filter(Boolean).join(" "));
  }

  return map;
}

/* -------------------------------------- */
/* Single instance                        */
/* -------------------------------------- */

export async function getTreatmentInstanceProfitability(
  treatmentPlanItemId: string
): Promise<TreatmentInstanceProfitability> {
  await assertPermission("treatment_profitability");

  const clinicId = await getCurrentClinicId();

  const { data: itemData, error: itemError } = await supabase
    .from("treatment_plan_items")
    .select(INSTANCE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("id", treatmentPlanItemId)
    .single();

  if (itemError) {
    logError("[treatmentInstanceProfitability] load treatment failed:", itemError);
    throw toError(itemError);
  }

  const row = itemData as unknown as RawTreatmentPlanItemRow;

  const { data: planData, error: planError } = await supabase
    .from("treatment_plans")
    .select("patient_id")
    .eq("id", row.treatment_plan_id)
    .single();

  if (planError) {
    logError("[treatmentInstanceProfitability] load plan failed:", planError);
    throw toError(planError);
  }

  const patientId = (planData as { patient_id: string }).patient_id;

  const [patientNames, usageByItem, invoicesById] = await Promise.all([
    loadPatientNames([patientId]),
    loadUsageByTreatmentPlanItemId([row.id]),
    loadInvoicesById(
      row.clinic_charges?.invoice_id ? [row.clinic_charges.invoice_id] : []
    ),
  ]);

  return buildInstanceProfitability(
    row,
    patientId,
    patientNames.get(patientId) ?? "Unknown patient",
    invoicesById,
    usageByItem
  );
}

/* -------------------------------------- */
/* Every performed instance of one catalog */
/* treatment, for a drill-down list        */
/* -------------------------------------- */

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Every treatment_plan_items instance whose procedure name matches
 * catalogTreatmentName (normalized the same way FIN-2's own
 * get_treatment_actuals_multi/get_treatment_actual_material_costs_multi
 * RPCs already do), within an optional date range. Fetched and filtered
 * client-side (not a new SQL aggregate RPC) - matches the existing
 * services/treatmentTeeth.ts#getTreatmentsForTooth precedent for a
 * per-instance (not aggregate) read, and keeps this phase's schema/RPC
 * footprint to the single integrity constraint in migration 0089.
 */
export async function getTreatmentInstanceProfitabilityForCatalogTreatment(
  catalogTreatmentName: string,
  start: Date | null,
  end: Date | null
): Promise<TreatmentInstanceProfitability[]> {
  await assertPermission("treatment_profitability");

  const clinicId = await getCurrentClinicId();
  const normalizedTarget = normalizeName(catalogTreatmentName);

  let query = supabase
    .from("treatment_plan_items")
    .select(INSTANCE_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (start) query = query.gte("created_at", start.toISOString());
  if (end) query = query.lte("created_at", end.toISOString());

  const rows = (await fetchAllRows((from, to) =>
    query.range(from, to)
  )) as unknown as RawTreatmentPlanItemRow[];

  const matching = rows.filter(
    (row) => normalizeName(row.procedure) === normalizedTarget
  );

  if (matching.length === 0) return [];

  const planIds = [...new Set(matching.map((row) => row.treatment_plan_id))];

  const { data: plansData, error: plansError } = await supabase
    .from("treatment_plans")
    .select("id, patient_id")
    .in("id", planIds);

  if (plansError) {
    logError("[treatmentInstanceProfitability] load plans failed:", plansError);
    throw toError(plansError);
  }

  const patientIdByPlanId = new Map(
    ((plansData ?? []) as { id: string; patient_id: string }[]).map((row) => [
      row.id,
      row.patient_id,
    ])
  );

  const patientIds = [...new Set(patientIdByPlanId.values())];

  const invoiceIds = [
    ...new Set(
      matching
        .map((row) => row.clinic_charges?.invoice_id)
        .filter((id): id is string => id != null)
    ),
  ];

  const [patientNames, usageByItem, invoicesById] = await Promise.all([
    loadPatientNames(patientIds),
    loadUsageByTreatmentPlanItemId(matching.map((row) => row.id)),
    loadInvoicesById(invoiceIds),
  ]);

  return matching.map((row) => {
    const patientId = patientIdByPlanId.get(row.treatment_plan_id) ?? "";

    return buildInstanceProfitability(
      row,
      patientId,
      patientNames.get(patientId) ?? "Unknown patient",
      invoicesById,
      usageByItem
    );
  });
}
