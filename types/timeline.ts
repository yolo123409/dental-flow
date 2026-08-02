export type TimelineType =
  | "appointment"
  | "treatment"
  | "invoice"
  | "reminder";

export interface TimelineItem {
  id: string;

  patient_id: string;

  title: string;

  description: string;

  created_at: string;

  type: TimelineType;
}