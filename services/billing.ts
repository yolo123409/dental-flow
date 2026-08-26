import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { roundMoney } from "@/lib/currency";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { getClinicSettings } from "./settings";
import { assertPermission } from "./authorization";
import {
  notifyInvoiceCreated,
  notifyPaymentRecorded,
} from "./notifications";

export interface ClinicInvoice {
  id: string;

  clinic_id: string;

  patient_id: string;

  invoice_number: string;

  subtotal: number;

  discount: number;

  tax: number;

  total: number;

  amount_paid: number;

  balance: number;

  status: string;

  notes: string | null;

  // Billing arrangement - who/how this invoice is billed, chosen once at
  // creation time. Independent of clinic_payments.payment_method (actual
  // money received, possibly across several payments over time).
  payment_method: string | null;

  insurance_provider_id: string | null;

  // Joined display name for insurance_provider_id - present whenever the
  // select list requests it (getInvoices/getInvoice both do).
  insurance_provider?: { name: string } | null;

  // Snapshot of the clinic's tax config at the moment this invoice was
  // created - never re-read from live clinic_settings, so a later change
  // to the clinic's tax rate/name/mode never alters how a past invoice
  // totals or displays.
  tax_enabled: boolean;
  tax_name: string;
  tax_rate: number;
  tax_inclusive: boolean;
  tax_registration_number: string | null;

  created_at: string;

  updated_at: string;
}

export interface InvoiceItem {
  id: string;

  invoice_id: string;

  treatment_name: string;

  quantity: number;

  unit_price: number;

  total_price: number;
}

export interface ClinicPayment {
  id: string;

  invoice_id: string;

  clinic_id: string;

  patient_id: string;

  amount: number;

  payment_method: string;

  // How THIS payment was received - independent of the invoice's own
  // insurance_provider_id (an invoice can have several payments, e.g. an
  // Insurance payment plus a separate M-Pesa patient copay).
  insurance_provider_id: string | null;

  insurance_provider?: { name: string } | null;

  reference: string | null;

  notes: string | null;

  received_at: string;

  created_at: string;
}

export interface ClinicCharge {
  id: string;

  clinic_id: string;

  patient_id: string;

  tooth_number: number | null;

  treatment_name: string;

  amount: number;

  status: string;

  invoice_id: string | null;

  /** Phase G (migration 0079): the treatment_plan_items row this charge
   * was created for, or null for a legacy Tooth Details charge
   * (services/patientTeeth.ts#saveTooth()) - the explicit, exact
   * discriminator Phase F found missing. Never inferred from
   * patient/tooth/name/amount - only ever set by
   * billTreatmentPlanItems() at charge-creation time. */
  treatment_plan_item_id: string | null;

  created_at: string;
}

/* -------------------------------------- */
/* Get Invoices                           */
/* -------------------------------------- */

// Safety cap, not a real pagination boundary - protects against an
// unbounded full-table fetch for a clinic that has accumulated many
// years of invoices (found during a production-hardening audit). A
// clinic actually approaching this many invoices needs real pagination
// UI on the Invoices page, which is a larger change than this fix.
export interface InvoiceListResult {
  rows: ClinicInvoice[];
  count: number;
}

/**
 * Real server-side pagination (Production Readiness 2.0), replacing the
 * previous 2,000-row safety cap - which was an explicitly-documented
 * stopgap, not real pagination, and would have started silently
 * dropping a clinic's oldest invoices past that count.
 */
export async function getInvoices(
  page = 1,
  pageSize = 50
): Promise<InvoiceListResult> {
  await assertPermission("billing");

  const clinicId =
    await getCurrentClinicId();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } =
    await supabase
      .from("clinic_invoices")
      .select("*, insurance_provider:insurance_providers(name)", { count: "exact" })
      .eq("clinic_id", clinicId)
      .order("created_at", {
        ascending: false,
      })
      .range(from, to);

  if (error) {
    logError("[billing] getInvoices failed:", error);

    throw toError(error);
  }

  return {
    rows: (data ?? []) as ClinicInvoice[],
    count: count ?? 0,
  };
}

/**
 * Lightweight alternative to getInvoices()+calculateBalance() for
 * callers that only need the clinic-wide outstanding balance total (e.g.
 * PatientStats on the Patients page) - selects just the two columns the
 * calculation actually needs instead of every invoice column plus the
 * insurance-provider join, and isn't capped by INVOICE_LIST_SAFETY_LIMIT
 * since a balance total must reflect every invoice, not just the most
 * recent ones. Uses the exact same calculateBalance() formula, so this
 * can never drift from what getInvoices()+calculateBalance() would
 * compute.
 */
export async function getInvoiceBalanceTotals(): Promise<
  ReturnType<typeof calculateBalance>
> {
  const clinicId = await getCurrentClinicId();

  // Aggregate RPC (migration 0067), not a `.select('total, amount_paid')`
  // fetch of every invoice row summed in JS - found to have the same
  // silent-truncation risk as the other unbounded sum queries fixed in
  // this pass. Same total/paid/outstanding formula as calculateBalance,
  // computed server-side instead.
  const { data, error } = await supabase.rpc("get_invoice_balance_totals", {
    p_clinic_id: clinicId,
  });

  if (error) {
    logError("[billing] getInvoiceBalanceTotals failed:", error);

    throw toError(error);
  }

  const row = (data?.[0] ?? { total: 0, paid: 0 }) as {
    total: number;
    paid: number;
  };

  const total = Number(row.total ?? 0);
  const paid = Number(row.paid ?? 0);

  return { total, paid, outstanding: total - paid };
}

/**
 * Phase O: the single authoritative "Outstanding AR" figure -
 * SUM(balance) WHERE balance > 0, computed server-side (RPC, migration
 * 0082). Deliberately NOT getInvoiceBalanceTotals().outstanding, which
 * nets every invoice's balance together clinic-wide - an overpaid
 * (negative-balance) invoice would silently reduce the reported total
 * owed on every OTHER invoice, which is never correct: this app has no
 * credit-balance/refund concept (migration 0043's own comment: "No
 * refund concept exists anywhere"), so an overpayment on one invoice is
 * not money available to apply against another. This function floors
 * each invoice's contribution at zero instead.
 *
 * getInvoiceBalanceTotals() itself is unchanged and still correct for
 * its OWN purpose (Total Invoiced / Total Paid) - only its `.outstanding`
 * field is being replaced at its call sites, not this function.
 *
 * Mathematically identical to getArSummary().totalOutstanding and to
 * getAccountsReceivableReport()'s reconciliation.invoiceOutstandingBalance
 * - both already fetch every outstanding invoice row for other reasons
 * (aging buckets, per-invoice detail) and keep summing their own
 * already-fetched rows rather than making an extra round trip here. This
 * function is for callers that only need the single total: the Billing
 * header, Patient Stats, and the AR reconciliation guard
 * (getArReconciliationStatus in services/accountsReceivable.ts).
 */
export async function getOutstandingInvoiceBalance(): Promise<number> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase.rpc("get_outstanding_invoice_balance", {
    p_clinic_id: clinicId,
  });

  if (error) {
    logError("[billing] getOutstandingInvoiceBalance failed:", error);

    throw toError(error);
  }

  const row = (data?.[0] ?? { outstanding: 0 }) as { outstanding: number };

  return Number(row.outstanding ?? 0);
}

/* -------------------------------------- */
/* Get Charges                            */
/* -------------------------------------- */

export async function getPendingCharges() {
  await assertPermission("billing");

  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_charges")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("status", "Pending")
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    logError("[billing] getPendingCharges failed:", error);

    throw toError(error);
  }

  return (
    data ?? []
  ) as ClinicCharge[];
}

/* -------------------------------------- */
/* Get Charges (Billing Control Center)   */
/* -------------------------------------- */

export interface ChargeListResult {
  rows: ClinicChargeWithDetails[];
  count: number;
}

export interface ChargeFilters {
  /** Omit for every status. */
  status?: "Pending" | "Invoiced";
  /** Omit for both. "canonical" = treatment_plan_item_id set (Phase G/H).
   * "legacy" = treatment_plan_item_id null (services/patientTeeth.ts). */
  source?: "canonical" | "legacy";
  /** Phase J section 14/15/16/17: filters on the LINKED INVOICE's own
   * state, never a property of the charge itself - "Outstanding"/"Paid"
   * describe an invoice's balance/status, not a clinic_charges row. Forces
   * an inner join on clinic_invoices (a charge with no invoice can never
   * match either value), so this is mutually exclusive in practice with
   * status: "Pending" (a Pending charge has no invoice yet). */
  invoiceStatus?: "Outstanding" | "Paid";
  /** Matches treatment name, patient name, or invoice number. */
  search?: string;
  /** Inclusive, ISO date/datetime bounds on created_at. */
  dateFrom?: string;
  dateTo?: string;
}

/** A charge joined with everything the Billing Control Center's table and
 * detail panel need to render without an N+1 query per row: who it's for,
 * which invoice (if any) it's on, and - for a canonical charge only - the
 * Treatment/Treatment Plan that generated it. treatment_plan_items is null
 * for a legacy charge (Phase G/H's exact discriminator), never a guess. */
export interface ClinicChargeWithDetails extends ClinicCharge {
  patients: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;

  clinic_invoices: {
    id: string;
    invoice_number: string;
    status: string;
    total: number;
    amount_paid: number;
    balance: number;
    payment_method: string | null;
    insurance_provider_id: string | null;
    insurance_provider: { name: string } | null;
  } | null;

  treatment_plan_items: {
    id: string;
    treatment_plan_id: string;
    procedure: string;
    quantity: number;
    tooth_number: number | null;
    treatment_teeth?: { tooth_number: number }[];
    treatment_plans: { id: string; title: string } | null;
  } | null;
}

// clinic_charges.treatment_plan_item_id -> treatment_plan_items.id
// (migration 0079) is a SECOND foreign key between these two tables, so
// the embed needs the same explicit constraint-name hint as the reverse
// direction in services/treatmentPlans.ts, or PostgREST can't infer which
// relationship "treatment_plan_items(...)" means (PGRST201).
//
// Phase J: the clinic_invoices embed is built with or without "!inner"
// depending on whether a filter needs to be applied to it. A charge with
// no invoice (invoice_id null, i.e. still Pending) must keep showing
// clinic_invoices as null in the normal (left-join) case - forcing an
// inner join unconditionally would silently drop every Pending charge
// from "All". Only getCharges()'s invoiceStatus filter (Outstanding/Paid,
// which are properties of the INVOICE, not the charge) needs the inner
// join, since PostgREST can only filter an embedded resource's own
// columns when it's joined that way.
function buildChargeDetailSelect(innerJoinInvoice: boolean): string {
  const invoiceEmbed = innerJoinInvoice
    ? "clinic_invoices!inner"
    : "clinic_invoices";

  return `
    *,
    patients (
      id, first_name, last_name
    ),
    ${invoiceEmbed} (
      id, invoice_number, status, total, amount_paid, balance,
      payment_method, insurance_provider_id,
      insurance_provider:insurance_providers ( name )
    ),
    treatment_plan_items!clinic_charges_treatment_plan_item_id_fkey (
      id, treatment_plan_id, procedure, quantity, tooth_number,
      treatment_teeth ( tooth_number ),
      treatment_plans ( id, title )
    )
  `;
}

// Small, capped lookups (not full-table scans) so a Billing search can
// match a patient name or invoice number without an expensive query -
// mirrors services/patients.ts#getPatients()'s own escaped-ilike pattern.
const SEARCH_ID_LOOKUP_LIMIT = 50;

async function lookupMatchingPatientIds(
  clinicId: string,
  term: string
): Promise<string[]> {
  const { data } = await supabase
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
    .limit(SEARCH_ID_LOOKUP_LIMIT);

  return (data ?? []).map((row) => row.id as string);
}

async function lookupMatchingInvoiceIds(
  clinicId: string,
  term: string
): Promise<string[]> {
  const { data } = await supabase
    .from("clinic_invoices")
    .select("id")
    .eq("clinic_id", clinicId)
    .ilike("invoice_number", `%${term}%`)
    .limit(SEARCH_ID_LOOKUP_LIMIT);

  return (data ?? []).map((row) => row.id as string);
}

/**
 * Real server-side pagination + filtering over EVERY charge (Pending and
 * Invoiced, canonical and legacy) - the Billing Control Center's "browse
 * everything" table (Phase I). Distinct from getPendingCharges() below,
 * which stays a deliberately unbounded fetch: Pending charges are a
 * self-clearing work queue (they leave it the moment they're invoiced),
 * not an ever-growing history, so the existing bulk-invoicing selection
 * flow still needs every Pending charge in one fetch, not one page of it.
 */
export async function getCharges(
  page = 1,
  pageSize = 50,
  filters: ChargeFilters = {}
): Promise<ChargeListResult> {
  await assertPermission("billing");

  const clinicId = await getCurrentClinicId();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("clinic_charges")
    .select(buildChargeDetailSelect(filters.invoiceStatus != null), {
      count: "exact",
    })
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.source === "canonical") {
    query = query.not("treatment_plan_item_id", "is", null);
  } else if (filters.source === "legacy") {
    query = query.is("treatment_plan_item_id", null);
  }

  if (filters.invoiceStatus === "Paid") {
    query = query.eq("clinic_invoices.status", "Paid");
  } else if (filters.invoiceStatus === "Outstanding") {
    query = query.gt("clinic_invoices.balance", 0);
  }

  if (filters.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }

  const term = filters.search?.trim();

  if (term) {
    const escaped = term.replace(/[%,]/g, "");

    const [patientIds, invoiceIds] = await Promise.all([
      lookupMatchingPatientIds(clinicId, escaped),
      lookupMatchingInvoiceIds(clinicId, escaped),
    ]);

    const orClauses = [`treatment_name.ilike.%${escaped}%`];

    if (patientIds.length > 0) {
      orClauses.push(`patient_id.in.(${patientIds.join(",")})`);
    }

    if (invoiceIds.length > 0) {
      orClauses.push(`invoice_id.in.(${invoiceIds.join(",")})`);
    }

    query = query.or(orClauses.join(","));
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    logError("[billing] getCharges failed:", error);

    throw toError(error);
  }

  return {
    rows: (data ?? []) as unknown as ClinicChargeWithDetails[],
    count: count ?? 0,
  };
}

/**
 * Phase J section 18/21/22: a targeted single-charge refetch, used to
 * update a charge's payment/invoice figures in place after
 * recordPayment() succeeds - without either closing the detail view or
 * re-deriving fresh numbers client-side (which recordPayment()'s own
 * authoritative amount_paid/balance/status calculation must remain the
 * only source of). Reuses the exact same select shape as getCharges().
 */
export async function getChargeById(
  chargeId: string
): Promise<ClinicChargeWithDetails | null> {
  await assertPermission("billing");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_charges")
    .select(buildChargeDetailSelect(false))
    .eq("clinic_id", clinicId)
    .eq("id", chargeId)
    .maybeSingle();

  if (error) {
    logError("[billing] getChargeById failed:", error);

    throw toError(error);
  }

  return data as unknown as ClinicChargeWithDetails | null;
}

/* -------------------------------------- */
/* Charge <-> Treatment link diagnostic   */
/* -------------------------------------- */

export interface BrokenChargeLink {
  chargeId: string;
  treatmentPlanItemId: string;
  reason: string;
}

/**
 * Phase I section 27: a read-only integrity check on the bidirectional
 * relationship Phase G/H established -
 * clinic_charges.treatment_plan_item_id and treatment_plan_items.charge_id
 * should always point back at each other for a canonical charge. Reports
 * mismatches; never repairs them - a broken link is a bug to investigate,
 * not production financial data to silently rewrite.
 */
export async function findBrokenCanonicalChargeLinks(): Promise<
  BrokenChargeLink[]
> {
  await assertPermission("billing");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_charges")
    .select(
      `id, treatment_plan_item_id,
       treatment_plan_items!clinic_charges_treatment_plan_item_id_fkey ( id, charge_id )`
    )
    .eq("clinic_id", clinicId)
    .not("treatment_plan_item_id", "is", null);

  if (error) {
    logError("[billing] findBrokenCanonicalChargeLinks failed:", error);

    throw toError(error);
  }

  const broken: BrokenChargeLink[] = [];

  for (const row of (data ?? []) as unknown as {
    id: string;
    treatment_plan_item_id: string;
    treatment_plan_items: { id: string; charge_id: string | null } | null;
  }[]) {
    const item = row.treatment_plan_items;

    if (!item) {
      broken.push({
        chargeId: row.id,
        treatmentPlanItemId: row.treatment_plan_item_id,
        reason: "Linked treatment_plan_item was not found.",
      });
    } else if (item.charge_id !== row.id) {
      broken.push({
        chargeId: row.id,
        treatmentPlanItemId: row.treatment_plan_item_id,
        reason: `treatment_plan_item.charge_id (${item.charge_id ?? "null"}) does not point back to this charge.`,
      });
    }
  }

  return broken;
}

/* -------------------------------------- */
/* Get Invoice                            */
/* -------------------------------------- */

export async function getInvoice(
  invoiceId: string
) {
  await assertPermission("billing");

  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_invoices")
      .select(`
        *,
        insurance_provider:insurance_providers (
          name
        ),
        patients (
          id,
          first_name,
          last_name,
          phone,
          email
        ),
        clinic_invoice_items (
          *
        ),
        clinic_payments (
          *,
          insurance_provider:insurance_providers (
            name
          )
        )
      `)
      .eq("clinic_id", clinicId)
      .eq("id", invoiceId)
      .single();

  if (error) {
    logError("[billing] getInvoice failed:", error);

    throw toError(error);
  }

  return data;
}

/* -------------------------------------- */
/* Generate Invoice Number                */
/* -------------------------------------- */

export async function generateInvoiceNumber() {
  const clinicId =
    await getCurrentClinicId();

  const { count } =
    await supabase
      .from("clinic_invoices")
      .select("*", {
        head: true,
        count: "exact",
      })
      .eq("clinic_id", clinicId);

  return `INV-${String(
    (count ?? 0) + 1
  ).padStart(5, "0")}`;
}

/* -------------------------------------- */
/* Tax Calculation (single source of truth) */
/* -------------------------------------- */

export interface TaxSettings {
  enabled: boolean;
  name: string;
  rate: number;
  inclusive: boolean;
  registrationNumber: string | null;
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Turns a gross line-item amount + discount + the clinic's tax config into
 * Subtotal/Tax/Total, keeping `subtotal + tax === total` in both pricing
 * modes:
 *  - Exclusive: tax is added on top of (gross - discount).
 *  - Inclusive: (gross - discount) already contains tax, so it IS the
 *    final total; tax is extracted out of it rather than added.
 * Reused by createInvoice() and by the invoice-creation UIs for a live
 * preview before the invoice is actually generated.
 */
export function calculateInvoiceTotals(
  grossAmount: number,
  discount: number,
  taxSettings: Pick<TaxSettings, "enabled" | "rate" | "inclusive">
): InvoiceTotals {
  const afterDiscount = roundMoney(
    grossAmount - discount
  );

  if (
    !taxSettings.enabled ||
    taxSettings.rate <= 0
  ) {
    return {
      subtotal: afterDiscount,
      tax: 0,
      total: afterDiscount,
    };
  }

  if (!taxSettings.inclusive) {
    const tax = roundMoney(
      afterDiscount *
        (taxSettings.rate / 100)
    );

    return {
      subtotal: afterDiscount,
      tax,
      total: roundMoney(
        afterDiscount + tax
      ),
    };
  }

  const subtotal = roundMoney(
    afterDiscount /
      (1 + taxSettings.rate / 100)
  );

  const tax = roundMoney(
    afterDiscount - subtotal
  );

  return {
    subtotal,
    tax,
    total: afterDiscount,
  };
}

/* -------------------------------------- */
/* Create Invoice                         */
/* -------------------------------------- */

export interface ChargeSelection {
  id: string;

  treatment_name: string;

  amount: number;
}

export async function createInvoice(
  patientId: string,
  charges: ChargeSelection[],
  discount = 0,
  notes?: string,
  paymentMethod?: string | null,
  insuranceProviderId?: string | null
) {
  await assertPermission("billing");

  // Mirrors the DB's clinic_invoices_insurance_provider_requires_method
  // constraint - checked here too so a missing provider produces a clear
  // toast instead of a raw constraint-violation message reaching the UI.
  if (paymentMethod === "Insurance" && !insuranceProviderId) {
    throw new Error(
      "Select an insurance provider to bill this invoice through insurance."
    );
  }

  const [clinicId, invoiceNumber, clinicSettings] =
    await Promise.all([
      getCurrentClinicId(),
      generateInvoiceNumber(),
      getClinicSettings(),
    ]);

  const grossAmount =
    charges.reduce(
      (sum, charge) =>
        sum + Number(charge.amount),
      0
    );

  const taxSettings: TaxSettings = {
    enabled: clinicSettings.tax_enabled,
    name: clinicSettings.tax_name,
    rate: Number(clinicSettings.tax_rate),
    inclusive:
      clinicSettings.prices_include_tax,
    registrationNumber:
      clinicSettings.tax_registration_number,
  };

  const { subtotal, tax, total } =
    calculateInvoiceTotals(
      grossAmount,
      discount,
      taxSettings
    );

  const balance =
    total;

  const {
    data: invoice,
    error: invoiceError,
  } = await supabase
    .from("clinic_invoices")
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      invoice_number: invoiceNumber,
      subtotal,
      discount,
      tax,
      total,
      amount_paid: 0,
      balance,
      status: "Unpaid",
      notes: notes ?? null,
      payment_method: paymentMethod ?? null,
      insurance_provider_id:
        paymentMethod === "Insurance"
          ? insuranceProviderId
          : null,
      tax_enabled: taxSettings.enabled,
      tax_name: taxSettings.name,
      tax_rate: taxSettings.rate,
      tax_inclusive: taxSettings.inclusive,
      tax_registration_number:
        taxSettings.registrationNumber,
    })
    .select()
    .single();

  if (invoiceError) {
    logError("[billing] createInvoice (insert invoice) failed:", invoiceError);

    throw toError(invoiceError);
  }

  const items =
    charges.map((charge) => ({
      invoice_id: invoice.id,
      treatment_name:
        charge.treatment_name,
      quantity: 1,
      unit_price: charge.amount,
      total_price: charge.amount,
    }));

  const { error: itemError } =
    await supabase
      .from("clinic_invoice_items")
      .insert(items);

  if (itemError) {
    logError("[billing] createInvoice (insert items) failed:", itemError);

    throw toError(itemError);
  }

  const chargeIds =
    charges.map((c) => c.id);

  const { error: chargeError } =
    await supabase
      .from("clinic_charges")
      .update({
        status: "Invoiced",
        invoice_id: invoice.id,
      })
      .in("id", chargeIds);

  if (chargeError) {
    logError("[billing] createInvoice (update charges) failed:", chargeError);

    throw toError(chargeError);
  }

  await notifyInvoiceCreated(invoice);

  return invoice;
}

/* -------------------------------------- */
/* Get Patient Invoices                   */
/* -------------------------------------- */

export async function getPatientInvoices(
  patientId: string
): Promise<ClinicInvoice[]> {
  await assertPermission("billing");

  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_invoices")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    logError("[billing] getPatientInvoices failed:", error);

    throw toError(error);
  }

  return (
    data ?? []
  ) as ClinicInvoice[];
}

/* -------------------------------------- */
/* Calculate Billing Summary              */
/* -------------------------------------- */

export function calculateBalance(
  invoices: Pick<
    ClinicInvoice,
    "total" | "amount_paid"
  >[]
) {
  const total =
    invoices.reduce(
      (sum, invoice) =>
        sum + Number(invoice.total),
      0
    );

  const paid =
    invoices.reduce(
      (sum, invoice) =>
        sum +
        Number(invoice.amount_paid),
      0
    );

  return {
    total,

    paid,

    outstanding:
      total - paid,
  };
}

/* -------------------------------------- */
/* Record Payment                         */
/* -------------------------------------- */

export async function recordPayment(
  invoiceId: string,
  amount: number,
  paymentMethod: string,
  reference?: string,
  notes?: string,
  insuranceProviderId?: string | null
) {
  await assertPermission("billing");

  // Phase J section 5/23/34: recordPayment() is the ONE authoritative
  // place a clinic_payments row is ever created (no second insertion
  // function, no client-side substitute) - so this is also the one place
  // that must reject a nonsensical amount, regardless of which UI called
  // it or what a possibly-stale screen displayed.
  if (!(amount > 0)) {
    throw new Error("Enter a payment amount greater than zero.");
  }

  // Mirrors clinic_payments_insurance_provider_requires_method - checked
  // here too so a missing provider produces a clear toast instead of a
  // raw constraint-violation message.
  if (paymentMethod === "Insurance" && !insuranceProviderId) {
    throw new Error(
      "Select an insurance provider to record this payment as insurance."
    );
  }

  const clinicId =
    await getCurrentClinicId();

  /* ----------------------------- */
  /* Load Invoice                  */
  /* ----------------------------- */

  const {
    data: invoice,
    error: invoiceError,
  } = await supabase
    .from("clinic_invoices")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", invoiceId)
    .single();

  if (invoiceError) {
    logError("[billing] recordPayment (load invoice) failed:", invoiceError);

    throw toError(invoiceError);
  }

  // Phase J section 5/24/34/37: the existing implementation had no
  // overpayment guard at all - found during this phase's audit (J1/J37),
  // not a deliberately-supported behavior, so it's closed here rather
  // than silently left open. Read against the balance JUST fetched above
  // (not whatever the calling UI had displayed), which narrows the
  // concurrent-double-payment window (J24) to this function's own
  // load-then-write round trip instead of however long a screen had been
  // sitting open - a real improvement without the new RPC/migration this
  // phase's own instructions say to avoid unless absolutely required.
  const outstandingBalance = roundMoney(Number(invoice.balance));

  if (amount > outstandingBalance) {
    throw new Error(
      `Payment amount exceeds the outstanding balance of ${outstandingBalance}.`
    );
  }

  /* ----------------------------- */
  /* Save Payment                  */
  /* ----------------------------- */

  const {
    error: paymentError,
  } = await supabase
    .from("clinic_payments")
    .insert({
      clinic_id: clinicId,

      invoice_id:
        invoice.id,

      patient_id:
        invoice.patient_id,

      amount,

      payment_method:
        paymentMethod,

      insurance_provider_id:
        paymentMethod === "Insurance"
          ? insuranceProviderId
          : null,

      reference:
        reference ?? null,

      notes:
        notes ?? null,
    });

  if (paymentError) {
    logError("[billing] recordPayment (insert payment) failed:", paymentError);

    throw toError(paymentError);
  }

  /* ----------------------------- */
  /* Update Invoice                */
  /* ----------------------------- */

  const amountPaid = roundMoney(
    Number(invoice.amount_paid) +
      amount
  );

  const balance = roundMoney(
    Number(invoice.total) -
      amountPaid
  );

  let status = "Unpaid";

  if (balance <= 0) {
    status = "Paid";
  } else if (
    amountPaid > 0
  ) {
    status =
      "Partially Paid";
  }

  const {
    error: updateError,
  } = await supabase
    .from("clinic_invoices")
    .update({
      amount_paid:
        amountPaid,

      balance,

      status,
    })
    .eq("id", invoice.id);

  if (updateError) {
    logError("[billing] recordPayment (update invoice) failed:", updateError);

    throw toError(updateError);
  }

  await notifyPaymentRecorded({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    amount,
  });
}

/* -------------------------------------- */
/* Accounts Receivable / Collections      */
/* (Phase K)                              */
/* -------------------------------------- */

// Phase K section 1/2: clinic_invoices has no due_date column and there is
// no payment-terms concept anywhere in this schema (confirmed against the
// same finding types/accountsReceivable.ts already documents for the
// Ledger's AR report) - so "age" is measured from the invoice's own
// created_at, never a fabricated due date. Buckets mirror that report's
// day boundaries exactly (0/30/60/90) so the two AR surfaces never
// disagree about what "60 days" means, even though this one is scoped to
// "billing" (not "ledger") permission and computed straight from
// clinic_invoices rather than the ledger account balance.
export type ArAgingBucketKey = "0-30" | "31-60" | "61-90" | "90+";

export interface ArAgingBucket {
  key: ArAgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

export interface ArOutstandingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  patientId: string;
  patientName: string;
  /** From clinic_invoice_items - the existing invoice line-item
   * architecture (Phase K section 21), never re-derived from charges. */
  treatmentSummary: string;
  total: number;
  amountPaid: number;
  balance: number;
  /** Always "Unpaid" or "Partially Paid" - a balance > 0 invoice can never
   * carry the "Paid" status (recordPayment() ties balance <= 0 to Paid). */
  status: string;
  ageDays: number;
  bucket: ArAgingBucketKey;
  paymentMethod: string | null;
  insuranceProviderId: string | null;
  insuranceProviderName: string | null;
}

export interface ArPatientSummary {
  patientId: string;
  patientName: string;
  outstanding: number;
  invoiceCount: number;
  oldestAgeDays: number;
}

export interface ArSummary {
  totalOutstanding: number;
  invoiceCount: number;
  patientCount: number;
  buckets: ArAgingBucket[];
  oldestInvoice: ArOutstandingInvoice | null;
  largestInvoice: ArOutstandingInvoice | null;
  /** Oldest-first (Phase K section 9's default collections ordering). */
  invoices: ArOutstandingInvoice[];
  /** Highest-outstanding-first. */
  patients: ArPatientSummary[];
}

interface RawArInvoiceRow {
  id: string;
  invoice_number: string;
  created_at: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  patient_id: string;
  payment_method: string | null;
  insurance_provider_id: string | null;
  patients: { id: string; first_name: string; last_name: string } | null;
  insurance_provider: { name: string } | null;
  clinic_invoice_items: { treatment_name: string }[] | null;
}

function summarizeInvoiceTreatments(
  items: { treatment_name: string }[] | null
): string {
  if (!items || items.length === 0) return "—";

  if (items.length === 1) return items[0].treatment_name;

  return `${items[0].treatment_name} (+${items.length - 1} more)`;
}

function agingBucketFor(ageDays: number): ArAgingBucketKey {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

/**
 * Phase K: the Accounts Receivable / Collections summary that powers the
 * Billing Control Center's Outstanding view - total, aging buckets,
 * per-patient aggregation, and the oldest/largest spotlight invoices.
 *
 * Every figure is derived from ONE fetched set of currently-outstanding
 * invoices (balance > 0), so the reconciliation invariant (total outstanding
 * = sum of bucket amounts = sum of patient totals) holds by construction,
 * never by cross-checking two different data sources.
 *
 * Phase O correction: this total is NOT the same as
 * getInvoiceBalanceTotals().outstanding whenever an overpaid (negative-
 * balance) invoice exists - that one nets every invoice's balance
 * together across the WHOLE clinic, so an overpayment on one already-
 * settled invoice silently reduces the reported total owed on every
 * OTHER invoice, which is never correct (this app has no credit-balance/
 * refund concept - see migration 0043's own comment - so an overpayment
 * is not money available to apply elsewhere). This function's balance>0
 * filter already floors each invoice's contribution at zero and is the
 * canonical definition; see getOutstandingInvoiceBalance() below for the
 * single-total (no per-invoice detail needed) equivalent of this same
 * filter, used by callers that don't need the full row set.
 *
 * Outstanding invoices are a bounded, self-clearing set (an invoice leaves
 * it the moment it's paid off), not an ever-growing history - so, like the
 * existing Ledger AR report (services/accountsReceivable.ts), this fetches
 * every one of them (via fetchAllRows, safe against PostgREST's default
 * row cap) rather than paginating, since aging-bucket and patient-level
 * aggregation both genuinely need the full set in memory.
 */
export async function getArSummary(): Promise<ArSummary> {
  await assertPermission("billing");

  const clinicId = await getCurrentClinicId();
  const now = Date.now();

  const rows = await fetchAllRows<RawArInvoiceRow>(
    (from, to) =>
      supabase
        .from("clinic_invoices")
        .select(
          `
          id, invoice_number, created_at, total, amount_paid, balance, status,
          patient_id, payment_method, insurance_provider_id,
          patients ( id, first_name, last_name ),
          insurance_provider:insurance_providers ( name ),
          clinic_invoice_items ( treatment_name )
        `
        )
        .eq("clinic_id", clinicId)
        .gt("balance", 0)
        .order("created_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: RawArInvoiceRow[] | null;
        error: unknown;
      }>
  );

  const invoices: ArOutstandingInvoice[] = rows.map((row) => {
    const ageDays = Math.max(
      0,
      Math.floor((now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      invoiceId: row.id,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.created_at,
      patientId: row.patient_id,
      patientName: row.patients
        ? `${row.patients.first_name} ${row.patients.last_name}`
        : "—",
      treatmentSummary: summarizeInvoiceTreatments(row.clinic_invoice_items),
      total: Number(row.total),
      amountPaid: Number(row.amount_paid),
      balance: Number(row.balance),
      status: row.status,
      ageDays,
      bucket: agingBucketFor(ageDays),
      paymentMethod: row.payment_method,
      insuranceProviderId: row.insurance_provider_id,
      insuranceProviderName: row.insurance_provider?.name ?? null,
    };
  });

  const bucketDefs: { key: ArAgingBucketKey; label: string }[] = [
    { key: "0-30", label: "0–30 Days" },
    { key: "31-60", label: "31–60 Days" },
    { key: "61-90", label: "61–90 Days" },
    { key: "90+", label: "90+ Days" },
  ];

  const buckets: ArAgingBucket[] = bucketDefs.map((def) => {
    const matching = invoices.filter((invoice) => invoice.bucket === def.key);

    return {
      key: def.key,
      label: def.label,
      amount: roundMoney(
        matching.reduce((sum, invoice) => sum + invoice.balance, 0)
      ),
      count: matching.length,
    };
  });

  const totalOutstanding = roundMoney(
    invoices.reduce((sum, invoice) => sum + invoice.balance, 0)
  );

  const patientMap = new Map<string, ArPatientSummary>();

  for (const invoice of invoices) {
    const existing = patientMap.get(invoice.patientId);

    if (existing) {
      existing.outstanding = roundMoney(existing.outstanding + invoice.balance);
      existing.invoiceCount += 1;
      existing.oldestAgeDays = Math.max(existing.oldestAgeDays, invoice.ageDays);
    } else {
      patientMap.set(invoice.patientId, {
        patientId: invoice.patientId,
        patientName: invoice.patientName,
        outstanding: invoice.balance,
        invoiceCount: 1,
        oldestAgeDays: invoice.ageDays,
      });
    }
  }

  const patients = [...patientMap.values()].sort(
    (a, b) => b.outstanding - a.outstanding
  );

  const oldestInvoice =
    invoices.length > 0
      ? invoices.reduce((oldest, invoice) =>
          invoice.ageDays > oldest.ageDays ? invoice : oldest
        )
      : null;

  const largestInvoice =
    invoices.length > 0
      ? invoices.reduce((largest, invoice) =>
          invoice.balance > largest.balance ? invoice : largest
        )
      : null;

  return {
    totalOutstanding,
    invoiceCount: invoices.length,
    patientCount: patientMap.size,
    buckets,
    oldestInvoice,
    largestInvoice,
    invoices,
    patients,
  };
}

/**
 * Phase L section 14: sum of clinic_invoices.discount for invoices
 * created within [start, end] - no existing report aggregates this
 * column, but it's a plain already-stored figure (set once at
 * createInvoice() time, never recomputed), not a new calculation engine.
 * Paged the same safe way as getRevenueChartData() rather than a single
 * unbounded fetch.
 */
export async function getDiscountTotal(
  start: Date | null,
  end: Date | null
): Promise<number> {
  await assertPermission("billing");

  const clinicId = await getCurrentClinicId();

  const rows = await fetchAllRows<{ discount: number }>((from, to) => {
    let query = supabase
      .from("clinic_invoices")
      .select("discount")
      .eq("clinic_id", clinicId);

    if (start) query = query.gte("created_at", start.toISOString());
    if (end) query = query.lte("created_at", end.toISOString());

    return query.range(from, to);
  });

  return roundMoney(rows.reduce((sum, row) => sum + Number(row.discount ?? 0), 0));
}
