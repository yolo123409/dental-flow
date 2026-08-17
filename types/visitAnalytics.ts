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
 * computed - a ratio's denominator is zero (e.g. no new patients this
 * period). `unavailableReason` always explains why. A real zero (e.g.
 * zero visits in a quiet period) is a value, not "unavailable".
 *
 * Acquisition source (migration 0053_patient_acquisition_source.sql)
 * belongs to the patient, not any single appointment/visit, and is only
 * ever explicitly recorded going forward - existing patients have
 * `acquisition_source = null`, meaning "not recorded", and are never
 * reclassified as Walk-in/Referral/Other/etc.
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

/**
 * One row of the Acquisition Summary - `source` is either a real
 * `AcquisitionSource` value or the literal "Not Recorded" bucket for new
 * patients whose acquisition_source is null. `percent` is relative to
 * Total New Patients this period (the literal denominator this feature's
 * spec states for both the Acquisition Summary and Referral Rate) and is
 * always null for the "Not Recorded" row - showing a percentage for
 * "we don't know" would misleadingly imply it's a real category.
 */
export interface AcquisitionSourceCount {
  source: string;
  count: number;
  percent: number | null;
}

/**
 * One row of Top Referral Sources - `source` is either a real
 * `ReferralSource` value or "Not Specified" (acquisition_source =
 * Referral but referral_source itself was left blank - allowed, since
 * referral_source is optional even under Referral). `percent` is
 * relative to Referral Patients specifically, not Total New Patients -
 * this is a breakdown *within* the referral cohort.
 */
export interface ReferralSourceCount {
  source: string;
  count: number;
  percent: number | null;
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

  /**
   * Among this period's New Patients only (per section 14 - acquisition
   * is about how a patient was newly acquired, not about who visited).
   * `acquisitionRecordedCount` + `notRecordedCount` always equals
   * `newPatients`. `acquisitionBreakdown` never includes a "Not
   * Recorded" row - that count is surfaced separately via
   * `notRecordedCount` so it can never be mistaken for a real source.
   */
  acquisitionRecordedCount: number;
  notRecordedNewPatients: number;
  acquisitionBreakdown: AcquisitionSourceCount[];

  walkInPatients: number;
  walkInPercent: MetricValue;

  referralPatients: number;
  referralRate: MetricValue;
  topReferralSources: ReferralSourceCount[];

  /** Returning Patients (this period) / patients who had a qualifying visit before the period started x 100. Not available when that eligible cohort is empty. */
  retentionRate: MetricValue;
  /** Size of the "eligible to return" cohort (patients with a qualifying visit before the period started) - shown for transparency whenever retentionRate is available. */
  retentionEligibleCohortSize: number | null;

  trendGranularity: "Weekly" | "Monthly";
  trend: VisitTrendPoint[];

  newPatientRows: VisitPatientRow[];
  returningPatientRows: VisitPatientRow[];
}
