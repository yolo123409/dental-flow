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

export interface SaveTreatmentItemInput {
  procedure: string;
  tooth_number: number | null;
  estimated_price: number;
  quantity: number;
  notes: string | null;
  priority: TreatmentItemPriority;
  status: TreatmentItemStatus;
}
