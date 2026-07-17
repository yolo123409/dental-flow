import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";

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
    throw error;
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
    throw error;
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
        clinic_invoice_items(*)
      `)
      .eq("clinic_id", clinicId)
      .eq("id", invoiceId)
      .single();

  if (error) {
    throw error;
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
/* Create Invoice                         */
/* -------------------------------------- */

interface ChargeSelection {
  id: string;

  treatment_name: string;

  amount: number;
}

export async function createInvoice(
  patientId: string,
  charges: ChargeSelection[],
  discount = 0,
  tax = 0,
  notes?: string
) {
  const clinicId =
    await getCurrentClinicId();

  const invoiceNumber =
    await generateInvoiceNumber();

  const subtotal =
    charges.reduce(
      (sum, charge) =>
        sum + Number(charge.amount),
      0
    );

  const total =
    subtotal -
    discount +
    tax;

  const balance =
    total;

  /* ----------------------------- */
  /* Create Invoice                */
  /* ----------------------------- */

  const {
    data: invoice,
    error: invoiceError,
  } = await supabase
    .from("clinic_invoices")
    .insert({
      clinic_id: clinicId,

      patient_id: patientId,

      invoice_number:
        invoiceNumber,

      subtotal,

      discount,

      tax,

      total,

      amount_paid: 0,

      balance,

      status: "Unpaid",

      notes:
        notes ?? null,
    })
    .select()
    .single();

  if (invoiceError) {
    throw invoiceError;
  }

  /* ----------------------------- */
  /* Create Invoice Items          */
  /* ----------------------------- */

  const items =
    charges.map(
      (charge) => ({
        invoice_id:
          invoice.id,

        treatment_name:
          charge.treatment_name,

        quantity: 1,

        unit_price:
          charge.amount,

        total_price:
          charge.amount,
      })
    );

  const {
    error: itemError,
  } = await supabase
    .from(
      "clinic_invoice_items"
    )
    .insert(items);

  if (itemError) {
    throw itemError;
  }

  /* ----------------------------- */
  /* Update Charges                */
  /* ----------------------------- */

  const chargeIds =
    charges.map(
      (charge) => charge.id
    );

  const {
    error: chargeError,
  } = await supabase
    .from("clinic_charges")
    .update({
      status:
        "Invoiced",

      invoice_id:
        invoice.id,
    })
    .in("id", chargeIds);

  if (chargeError) {
    throw chargeError;
  }

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
    throw error;
  }

  return (
    data ?? []
  ) as ClinicInvoice[];
}

/* -------------------------------------- */
/* Calculate Billing Summary              */
/* -------------------------------------- */

export function calculateBalance(
  invoices: ClinicInvoice[]
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