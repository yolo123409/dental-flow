/**
 * Clinic Visit & Patient Acquisition Analytics - built directly from
 * `appointments`/`patients`, not a second patient or appointment system.
 *
 * A "qualifying visit" is an appointment with status = 'Completed' -
 * the same status this codebase already treats as the canonical
 * "attended" state everywhere else (services/appointments.ts'
 * AppointmentStats, the notifyAppointmentCompleted flow, and the
 * get_appointment_analytics RPC's own `completed` field all use exactly
 * this status string). Scheduled/Ongoing/Cancelled/Missed appointments
 * are never counted as visits.
 *
 * `MetricValue.value` is null whenever a figure cannot be reliably
 * computed - either the underlying data genuinely doesn't exist in this
 * schema (Walk-ins, Referrals - confirmed absent by live inspection, not
 * assumed) or a ratio's denominator is zero. `unavailableReason` always
 * explains why. A real zero (e.g. zero visits in a quiet period) is a
 * value, not "unavailable".
 */
export interface MetricValue {
  value: number | null;
  unavailableReason: string | null;
}

export interface VisitPatientRow {
  patientId: string;
  name: string;
  /** For New Patients: their first-ever qualifying visit date. For Returning Patients: their most recent qualifying visit date within the selected period. */
  visitDate: string;
}

export interface VisitTrendPoint {
  bucketLabel: string;
  bucketStart: string;
  bucketEnd: string;
  newPatients: number;
  returningPatients: number;
  totalVisits: number;
}

export interface VisitAnalyticsReport {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;

  /** Count of appointments with status = 'Completed' in the period - reconciles exactly with AppointmentStats.completed / get_appointment_analytics(...).completed for the same range. */
  totalVisits: number;

  /** Unique patients whose first-ever qualifying visit (all-time) falls within the selected period. */
  newPatients: number;
  /** Unique patients with a qualifying visit in the period who also had at least one qualifying visit before the period started. */
  returningPatients: number;

  /** newPatients / (newPatients + returningPatients) x 100. Not available when no qualifying visits occurred this period. */
  newPatientPercent: MetricValue;
  returningPatientPercent: MetricValue;

  /** Always unavailable in this schema - no walk-in/source field exists on appointments or patients (confirmed by direct inspection). */
  walkInVisits: MetricValue;
  scheduledVisits: MetricValue;
  walkInPercent: MetricValue;

  /** Always unavailable in this schema - no referral field/table exists (confirmed by direct inspection, including a live probe for common referral table names). */
  referralPatients: MetricValue;
  referralRate: MetricValue;
  topReferralSources: { source: string; count: number }[] | null;

  /** Returning Patients (this period) / patients who had a qualifying visit before the period started x 100. Not available when that eligible cohort is empty. */
  retentionRate: MetricValue;
  /** Size of the "eligible to return" cohort (patients with a qualifying visit before the period started) - shown for transparency whenever retentionRate is available. */
  retentionEligibleCohortSize: number | null;

  trendGranularity: "Weekly" | "Monthly";
  trend: VisitTrendPoint[];

  newPatientRows: VisitPatientRow[];
  returningPatientRows: VisitPatientRow[];
}
