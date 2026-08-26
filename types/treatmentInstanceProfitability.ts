/**
 * FIN-2.5: "how profitable was THIS specific treatment" - one row per real
 * treatment_plan_items instance, never a catalog-level aggregate (that
 * remains services/treatmentProfitability.ts, unchanged). See
 * services/treatmentInstanceProfitability.ts for the full data-flow
 * reasoning (revenue via the existing treatment_plan_items.charge_id ->
 * clinic_charges link, actual cost via FIN-2's treatment_material_usage).
 */

/**
 * NoCharge: estimated_price was never positive, so no clinic_charges row
 * was ever staged for this treatment - genuinely not billable yet, not
 * merely "not yet invoiced".
 * Pending: a charge exists (staged, billable) but has not been invoiced -
 * revenue is not yet recognized under the accrual convention
 * getProfitAndLoss() itself uses (revenue recognized at invoice creation).
 * Invoiced: the charge has been invoiced - clinic_charges.amount is the
 * exact, already-recognized revenue for this instance (see the migration
 * 0089 header comment for why that value is authoritative and never
 * drifts from what's actually on the invoice).
 */
export type TreatmentInstanceBillingStatus = "NoCharge" | "Pending" | "Invoiced";

export interface TreatmentInstanceMaterialLine {
  inventoryItemId: string;
  name: string;
  unit: string;
  quantity: number;
  /** The historical weighted-average cost stored on treatment_material_usage
   * at the time it was consumed - never today's live inventory cost. */
  unitCost: number;
  totalCost: number;
}

export interface TreatmentInstanceProfitability {
  treatmentPlanItemId: string;

  patientId: string;
  patientName: string;

  procedure: string;
  toothNumbers: number[];
  status: string;
  performedAt: string;

  billingStatus: TreatmentInstanceBillingStatus;

  /** Recognized revenue for this exact instance - 0 while NoCharge/Pending,
   * clinic_charges.amount once Invoiced. Never cash collected - see
   * invoiceAmountPaid/invoiceBalance below for that, kept deliberately
   * separate. */
  revenue: number;

  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The PARENT invoice's own status/amount_paid/balance - informational
   * cash-collection context for the whole invoice (which may bundle other
   * treatments too), never allocated down to this one line - there is no
   * reliable primitive in this schema to split a partial payment across
   * an invoice's individual lines, so this deliberately is not attempted. */
  invoiceStatus: string | null;
  invoiceAmountPaid: number | null;
  invoiceBalance: number | null;

  materials: TreatmentInstanceMaterialLine[];
  /** Sum of materials[].totalCost - real inventory consumption cost only.
   * Current actual treatment cost is inventory material consumption only;
   * there is no other actual (non-estimated) direct-cost source anywhere
   * in this codebase today. */
  actualMaterialCost: number;

  /** revenue - actualMaterialCost. Always a real number (never null) -
   * a treatment that hasn't been invoiced yet still has a genuine gross
   * profit figure (typically negative, reflecting real spend against
   * not-yet-recognized revenue), which is meaningful information, not an
   * error state. */
  grossProfit: number;

  /** null only when revenue <= 0 - a percentage of zero/negative revenue
   * is not a meaningful number, so this is never fabricated or divided by
   * zero. */
  grossMarginPercent: number | null;
}
