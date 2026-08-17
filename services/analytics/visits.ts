import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "@/services/clinic";

import { monthLabel, shortDate } from "@/lib/reports/period";

import { MetricValue, VisitAnalyticsReport, VisitPatientRow, VisitTrendPoint } from "@/types/visitAnalytics";

/**
 * Same "date-only" conversion services/appointments.ts already uses for
 * appointment_date comparisons (e.g. getTodaysAppointments) - kept
 * consistent with that existing convention rather than introducing a
 * different one for this feature.
 */
function toDateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function metric(value: number): MetricValue {
  return { value, unavailableReason: null };
}

function unavailable(reason: string): MetricValue {
  return { value: null, unavailableReason: reason };
}

const NOT_RECORDED_WALKIN =
  "Not available — walk-in source is not currently recorded. Neither the appointments nor patients table has a walk-in/booking-source field in this clinic's schema.";
const NOT_RECORDED_REFERRAL =
  "Not available — referral source is not currently recorded. No referral field or table exists in this clinic's schema.";

interface CompletedVisitRow {
  patient_id: string;
  appointment_date: string;
  patients: { first_name: string; last_name: string } | null;
}

function patientName(row: CompletedVisitRow): string {
  return row.patients ? `${row.patients.first_name} ${row.patients.last_name}` : "Unknown Patient";
}

interface Bucket {
  start: string;
  end: string;
  label: string;
}

function buildWeeklyBuckets(startIso: string, endIso: string): Bucket[] {
  const buckets: Bucket[] = [];
  let cursor = startIso;

  while (cursor <= endIso) {
    const naturalEnd = addDaysToDateOnly(cursor, 6);
    const end = naturalEnd > endIso ? endIso : naturalEnd;

    buckets.push({
      start: cursor,
      end,
      label: `${shortDate(new Date(`${cursor}T00:00:00Z`))} – ${shortDate(new Date(`${end}T00:00:00Z`))}`,
    });

    cursor = addDaysToDateOnly(end, 1);
  }

  return buckets;
}

function buildMonthlyBuckets(startIso: string, endIso: string): Bucket[] {
  const buckets: Bucket[] = [];
  let [y, m] = startIso.split("-").map(Number);
  let cursor = startIso;

  while (cursor <= endIso) {
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    const naturalEnd = `${y}-${pad2(m)}-${pad2(lastDayOfMonth)}`;
    const end = naturalEnd > endIso ? endIso : naturalEnd;

    buckets.push({
      start: cursor,
      end,
      label: monthLabel(new Date(y, m - 1, 1)),
    });

    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    cursor = `${y}-${pad2(m)}-01`;
  }

  return buckets;
}

/**
 * Clinic Visit & Patient Acquisition Analytics - entirely a read-only
 * read of `appointments`/`patients` (the same tables the rest of the app
 * already treats as authoritative), never a new patient/visit system.
 *
 * Every completed appointment, all-time, is fetched once (not per
 * period) to determine each patient's genuine first-ever qualifying
 * visit date - this is what makes New vs Returning correct, rather than
 * relying on patients.created_at (which only marks when the patient
 * RECORD was created, not their first actual visit) or patients.last_visit
 * (confirmed, by live inspection, to be null for every patient in this
 * schema - an unmaintained column, not a reliable signal).
 */
export async function getVisitAnalyticsReport(
  start: Date,
  end: Date,
  periodLabel: string
): Promise<VisitAnalyticsReport> {
  const clinicId = await getCurrentClinicId();

  const startIso = toDateOnly(start);
  const endIso = toDateOnly(end);

  const { data, error } = await supabase
    .from("appointments")
    .select("patient_id, appointment_date, patients ( first_name, last_name )")
    .eq("clinic_id", clinicId)
    .eq("status", "Completed")
    .order("appointment_date", { ascending: true });

  if (error) {
    logError("[analytics/visits] getVisitAnalyticsReport failed:", error);
    throw toError(error);
  }

  const allCompleted = (data ?? []) as unknown as CompletedVisitRow[];

  const firstVisitByPatient = new Map<string, string>();
  for (const row of allCompleted) {
    if (!firstVisitByPatient.has(row.patient_id)) {
      firstVisitByPatient.set(row.patient_id, row.appointment_date);
    }
  }

  const inPeriod = allCompleted.filter(
    (row) => row.appointment_date >= startIso && row.appointment_date <= endIso
  );

  const totalVisits = inPeriod.length;

  const newPatientIds = new Set<string>();
  const returningPatientIds = new Set<string>();
  const nameById = new Map<string, string>();
  const lastVisitInPeriodById = new Map<string, string>();

  for (const row of inPeriod) {
    nameById.set(row.patient_id, patientName(row));

    const firstVisit = firstVisitByPatient.get(row.patient_id)!;
    if (firstVisit >= startIso) {
      newPatientIds.add(row.patient_id);
    } else {
      returningPatientIds.add(row.patient_id);
    }

    const current = lastVisitInPeriodById.get(row.patient_id);
    if (!current || row.appointment_date > current) {
      lastVisitInPeriodById.set(row.patient_id, row.appointment_date);
    }
  }

  const uniquePatientsThisPeriod = newPatientIds.size + returningPatientIds.size;

  const newPatientPercent: MetricValue =
    uniquePatientsThisPeriod === 0
      ? unavailable("Not available — no qualifying visits were recorded in this period")
      : metric((newPatientIds.size / uniquePatientsThisPeriod) * 100);

  const returningPatientPercent: MetricValue =
    uniquePatientsThisPeriod === 0
      ? unavailable("Not available — no qualifying visits were recorded in this period")
      : metric((returningPatientIds.size / uniquePatientsThisPeriod) * 100);

  const newPatientRows: VisitPatientRow[] = Array.from(newPatientIds)
    .map((id) => ({
      patientId: id,
      name: nameById.get(id) ?? "Unknown Patient",
      visitDate: firstVisitByPatient.get(id)!,
    }))
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate));

  const returningPatientRows: VisitPatientRow[] = Array.from(returningPatientIds)
    .map((id) => ({
      patientId: id,
      name: nameById.get(id) ?? "Unknown Patient",
      visitDate: lastVisitInPeriodById.get(id)!,
    }))
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate));

  /* ---------------- Retention ---------------- */

  const eligibleToReturnCohort = new Set(
    allCompleted.filter((row) => row.appointment_date < startIso).map((row) => row.patient_id)
  );

  const retentionRate: MetricValue =
    eligibleToReturnCohort.size === 0
      ? unavailable(
          "Not available — no patients had a qualifying visit before this period started, so a retention cohort cannot be established"
        )
      : metric((returningPatientIds.size / eligibleToReturnCohort.size) * 100);

  /* ---------------- Trend ---------------- */

  const spanDays =
    Math.round(
      (new Date(`${endIso}T00:00:00Z`).getTime() - new Date(`${startIso}T00:00:00Z`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;

  const trendGranularity: "Weekly" | "Monthly" = spanDays <= 45 ? "Weekly" : "Monthly";
  const buckets =
    trendGranularity === "Weekly" ? buildWeeklyBuckets(startIso, endIso) : buildMonthlyBuckets(startIso, endIso);

  const trend: VisitTrendPoint[] = buckets.map((bucket) => {
    const rowsInBucket = inPeriod.filter(
      (row) => row.appointment_date >= bucket.start && row.appointment_date <= bucket.end
    );

    const bucketNew = new Set<string>();
    const bucketReturning = new Set<string>();

    for (const row of rowsInBucket) {
      const firstVisit = firstVisitByPatient.get(row.patient_id)!;
      if (firstVisit >= bucket.start) bucketNew.add(row.patient_id);
      else bucketReturning.add(row.patient_id);
    }

    return {
      bucketLabel: bucket.label,
      bucketStart: bucket.start,
      bucketEnd: bucket.end,
      newPatients: bucketNew.size,
      returningPatients: bucketReturning.size,
      totalVisits: rowsInBucket.length,
    };
  });

  return {
    periodLabel,
    periodStart: startIso,
    periodEnd: endIso,

    totalVisits,

    newPatients: newPatientIds.size,
    returningPatients: returningPatientIds.size,

    newPatientPercent,
    returningPatientPercent,

    walkInVisits: unavailable(NOT_RECORDED_WALKIN),
    scheduledVisits: unavailable(NOT_RECORDED_WALKIN),
    walkInPercent: unavailable(NOT_RECORDED_WALKIN),

    referralPatients: unavailable(NOT_RECORDED_REFERRAL),
    referralRate: unavailable(NOT_RECORDED_REFERRAL),
    topReferralSources: null,

    retentionRate,
    retentionEligibleCohortSize: eligibleToReturnCohort.size === 0 ? null : eligibleToReturnCohort.size,

    trendGranularity,
    trend,

    newPatientRows,
    returningPatientRows,
  };
}
