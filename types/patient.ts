export type PatientGender =
  | "Male"
  | "Female"
  | "Other";

/**
 * How the patient first came to the clinic. Belongs to the patient (not
 * each appointment) since it describes their original acquisition, not
 * any single visit. Plain string union (not a DB enum) so new sources
 * can be added later without an ALTER TYPE migration - see migration
 * 0053_patient_acquisition_source.sql.
 */
export type AcquisitionSource =
  | "Walk-in"
  | "Referral"
  | "Google"
  | "Social Media"
  | "Website"
  | "Phone"
  | "Existing Patient"
  | "Other"
  | "Unknown";

export type ReferralSource =
  | "Existing Patient"
  | "Dentist"
  | "Doctor"
  | "Clinic"
  | "Friend/Family"
  | "Employer"
  | "Other";

/**
 * Canonical, ordered list of every selectable AcquisitionSource - the
 * single source of truth shared by the patient form (its <select>
 * options) and Visit Analytics (its Acquisition Summary breakdown order)
 * so the two can never silently drift apart.
 */
export const ACQUISITION_SOURCES: AcquisitionSource[] = [
  "Unknown",
  "Walk-in",
  "Referral",
  "Google",
  "Social Media",
  "Website",
  "Phone",
  "Existing Patient",
  "Other",
];

/**
 * Canonical, ordered list of every selectable ReferralSource - shared by
 * the patient form and Visit Analytics' Top Referral Sources breakdown.
 */
export const REFERRAL_SOURCES: ReferralSource[] = [
  "Existing Patient",
  "Dentist",
  "Doctor",
  "Clinic",
  "Friend/Family",
  "Employer",
  "Other",
];

export interface Patient {
  id: string;

  first_name: string;

  last_name: string;

  phone: string;

  email: string | null;

  gender: PatientGender | null;

  date_of_birth: string | null;

  address: string | null;

  allergies: string | null;

  medical_history: string | null;

  created_at: string;

  /** Null means "not recorded" - never backfilled for existing patients, never treated as Walk-in or any other value. */
  acquisition_source: AcquisitionSource | null;

  /** Only meaningful when acquisition_source = "Referral"; null otherwise. */
  referral_source: ReferralSource | null;

  /** Free text (e.g. a referring patient's or dentist's name). Optional even when referral_source is set. */
  referral_source_name: string | null;
}
