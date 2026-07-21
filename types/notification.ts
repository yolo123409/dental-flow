export type NotificationType =
  | "patient"
  | "appointment"
  | "billing"
  | "staff"
  | "treatment_plan"
  | "system";

export type NotificationEntityType =
  | "patient"
  | "appointment"
  | "invoice"
  | "staff";

export interface Notification {
  id: string;
  clinic_id: string;
  user_id: string | null;
  title: string;
  message: string;
  type: NotificationType;
  entity_type: NotificationEntityType | null;
  entity_id: string | null;
  read: boolean;
  created_at: string;
}

export interface CreateNotificationInput {
  title: string;
  message: string;
  type: NotificationType;
  entity_type?: NotificationEntityType | null;
  entity_id?: string | null;
  /** Leave unset for a clinic-wide notification. */
  user_id?: string | null;
}
