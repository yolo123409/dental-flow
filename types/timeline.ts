export type TimelineType =
  | "appointment"
  | "treatment"
  | "invoice"
  | "reminder";

/** Compact display form for a timeline badge - just enough to show "ICD-10-CM: K02.9" without pulling in the full ClinicalCode shape. */
export interface TimelineCodeBadge {
  codeSystem: string;
  code: string;
  shortDescription: string;
}

export interface TimelineItem {
  id: string;

  patient_id: string;

  title: string;

  description: string;

  created_at: string;

  type: TimelineType;

  /**
   * Only ever populated for "treatment" items tied to a specific tooth
   * (via clinic_charges.tooth_number) that has coding explicitly
   * recorded against it - never backfilled, never shown for
   * appointment/invoice/reminder items or for a tooth with no coding.
   */
  diagnosisCodes?: TimelineCodeBadge[];
  procedureCodes?: TimelineCodeBadge[];
}
