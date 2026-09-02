export type AppointmentStatus =
  | "Scheduled"
  | "Ongoing"
  | "Completed"
  | "Cancelled"
  | "Missed";

export interface Appointment {
  id: string;

  patient_id: string;

  appointment_date: string;

  appointment_time: string;

  duration: number | null;

  treatment: string;

  notes: string | null;

  status: AppointmentStatus;

  dentist_id: string | null;

  dentists?: {
    full_name: string;
  } | null;

  patients?: {
    first_name: string;
    last_name: string;
  } | null;

  /** Phase B/C: the single planned treatment this appointment is for, if
   * any. Optional - most appointments (checkups, consults) have none. */
  treatment_plan_item_id?: string | null;

  /** Populated only by getAppointmentById() (a to-one embed - object or
   * null, not an array, since treatment_plan_item_id is a single FK). */
  treatment_plan_items?: {
    id: string;
    procedure: string;
    status: string;
    charge_id: string | null;
  } | null;
}
