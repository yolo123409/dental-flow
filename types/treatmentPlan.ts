export type TreatmentPlanStatus =
  | "Draft"
  | "Planned"
  | "In Progress"
  | "Completed"
  | "Cancelled";

export type TreatmentItemPriority =
  | "Low"
  | "Medium"
  | "High";

export type TreatmentItemStatus =
  | "Planned"
  | "In Progress"
  | "Completed"
  | "Cancelled";

export interface TreatmentPlan {
  id: string;

  clinic_id: string;

  patient_id: string;

  created_by: string | null;

  title: string;

  notes: string | null;

  status: TreatmentPlanStatus;

  created_at: string;

  updated_at: string;
}

export interface TreatmentPlanItem {
  id: string;

  clinic_id: string;

  treatment_plan_id: string;

  procedure: string;

  /** Legacy single-tooth compatibility field - null for a grouped
   * (multi-tooth) treatment. See treatment_teeth below for the real
   * source of truth on which teeth this treatment applies to. */
  tooth_number: number | null;

  estimated_price: number;

  quantity: number;

  notes: string | null;

  priority: TreatmentItemPriority;

  status: TreatmentItemStatus;

  sort_order: number;

  charge_id: string | null;

  created_at: string;

  updated_at: string;

  /** Populated by getTreatmentPlans()/getTreatmentPlan() via a nested
   * select on treatment_teeth (migration 0072) - every tooth this
   * treatment is associated with. Absent (not just empty) for callers
   * that don't request the nested select - use getItemTeeth() in
   * services/treatmentPlans.ts rather than reading this directly, since
   * it also falls back to tooth_number for items that predate this
   * relationship or were created through a path that doesn't populate it. */
  treatment_teeth?: { tooth_number: number }[];

  /** Phase H (migration 0079/0080): the linked charge's own status, via
   * charge_id - a to-one embed (object or null), unlike treatment_teeth.
   * charge_id being set no longer means "invoiced" by itself (every
   * billable Treatment gets a charge immediately on creation, while
   * still Pending) - use isItemInvoiced() in services/treatmentPlans.ts
   * rather than reading charge_id directly for anything UI-facing
   * (a "Billed" badge, a teeth-locked check, an "Invoiced" total).
   *
   * Billing audit fix #3 (migration 0112): once deposit_charge_id is
   * set, charge_id refers to the BALANCE, not the whole treatment - the
   * item is only fully invoiced once BOTH charges are Invoiced. Use
   * isItemInvoiced() rather than reading either status directly. */
  clinic_charges?: { status: string; amount: number } | null;

  deposit_charge_id: string | null;
  deposit_charge?: { status: string; amount: number } | null;
}

export interface TreatmentPlanWithItems extends TreatmentPlan {
  treatment_plan_items: TreatmentPlanItem[];
}

export interface TreatmentPlanTotals {
  totalEstimated: number;
  totalCompleted: number;
  remaining: number;
  procedureCount: number;
  completedCount: number;
  progress: number;
}

export interface SaveTreatmentPlanInput {
  patient_id: string;
  title: string;
  notes: string | null;
  status: TreatmentPlanStatus;
}

/** Phase D: tooth_numbers replaces the old singular tooth_number field
 * here - [] is a legitimate "no tooth association" Treatment (a
 * consultation, a general exam, etc.), [n] is single-tooth, [n, n, ...]
 * is grouped/multi-tooth. This is the shared shape both TreatmentItemModal
 * (Treatment Plan tab) and BulkTreatmentModal (odontogram) build, so both
 * UIs feed the one canonical createTreatment()/updateTreatmentTeeth() pair
 * in services/treatmentPlans.ts - see CORE OBJECTIVE in the Phase D spec. */
export interface SaveTreatmentItemInput {
  procedure: string;
  tooth_numbers: number[];
  estimated_price: number;
  /** Only meaningful when tooth_numbers is empty - createTreatment()
   * derives quantity from tooth_numbers.length whenever there IS at
   * least one tooth (the established per-tooth-price rule from Phase C),
   * exactly like updateTreatmentTeeth() does when teeth are edited. */
  quantity: number;
  notes: string | null;
  priority: TreatmentItemPriority;
  status: TreatmentItemStatus;
}

/** The one canonical Treatment creation input (Phase D) - every creation
 * entry point (odontogram multi-select, Treatment Plan "+ Add Treatment",
 * single-tooth) builds this and calls createTreatment(), which always
 * goes through the create_treatment_with_teeth RPC (0073, generalized by
 * 0076 to also accept zero teeth) so a Treatment + its teeth are created
 * atomically regardless of how many teeth (0, 1, or many) it has. */
export interface CreateTreatmentInput {
  treatment_plan_id: string;
  procedure: string;
  tooth_numbers: number[];
  estimated_price: number;
  quantity: number;
  notes: string | null;
  priority: TreatmentItemPriority;
  status: TreatmentItemStatus;
}
