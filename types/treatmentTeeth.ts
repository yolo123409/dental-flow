/**
 * Treatment <-> Teeth relationship (migration 0072_treatment_teeth.sql) -
 * Phase A foundation only. treatment_plan_items.tooth_number remains the
 * single-tooth compatibility field; this table is the additive
 * many-to-many relationship Phase B will build the multi-tooth
 * treatment workflow on top of.
 */
export interface TreatmentTooth {
  id: string;

  clinic_id: string;

  treatment_plan_item_id: string;

  tooth_number: number;

  created_at: string;
}
