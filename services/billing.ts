import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { roundMoney } from "@/lib/currency";

import { getCurrentClinicId } from "./clinic";
import { getClinicSettings } from "./settings";
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

  created_at: string;
}

/* -------------------------------------- */
/* Get Invoices                           */
/* -------------------------------------- */

export async function getInvoices() {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_invoices")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    logError("[billing] getInvoices failed:", error);

    throw toError(error);
  }

  return (
    data ?? []
  ) as ClinicInvoice[];
}

/* -------------------------------------- */
/* Get Charges                            */
/* -------------------------------------- */

export async function getPendingCharges() {
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
/* Get Invoice                            */
/* -------------------------------------- */

export async function getInvoice(
  invoiceId: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_invoices")
      .select(`
        *,
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
          *
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
  notes?: string
) {
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
  notes?: string
) {
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
