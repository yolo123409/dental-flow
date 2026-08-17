"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import Card from "@/components/ui/Card";
import ReportStatCard from "@/components/reports/ReportStatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getVisitAnalyticsReport } from "@/services/analytics/visits";
import { MetricValue, VisitAnalyticsReport, VisitPatientRow } from "@/types/visitAnalytics";

import { REPORT_RANGE_OPTIONS, ResolvedPeriod, resolveCurrentPeriod } from "@/lib/reports/period";

function formatMetric(metric: MetricValue, suffix = ""): string {
  return metric.value == null ? "Not available" : `${metric.value.toFixed(1)}${suffix}`;
}

function MetricStatCard({ title, metric, suffix = "" }: { title: string; metric: MetricValue; suffix?: string }) {
  return (
    <ReportStatCard
      title={title}
      value={formatMetric(metric, suffix)}
      subtitle={metric.value == null ? (metric.unavailableReason ?? undefined) : undefined}
    />
  );
}

function PatientRowsTable({ title, rows, dateLabel }: { title: string; rows: VisitPatientRow[]; dateLabel: string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-mineral">No patients in this category for the selected period.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold">Patient</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">{dateLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.patientId} className="border-t border-slate-200">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/patients/${row.patientId}`}
                      className="font-medium text-eucalyptus hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-slate-600">
                    {new Date(row.visitDate).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function VisitAnalyticsPageContent() {
  const [loading, setLoading] = useState(true);
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [report, setReport] = useState<VisitAnalyticsReport | null>(null);

  const resolvedPeriod = useMemo<ResolvedPeriod | null>(
    () => resolveCurrentPeriod(rangeLabel, customStart, customEnd),
    [rangeLabel, customStart, customEnd]
  );

  const load = useCallback(async () => {
    if (!resolvedPeriod) return;

    try {
      setLoading(true);

      const data = await getVisitAnalyticsReport(resolvedPeriod.start, resolvedPeriod.end, resolvedPeriod.label);

      setReport(data);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to load Visit Analytics.");
    } finally {
      setLoading(false);
    }
  }, [resolvedPeriod]);

  useEffect(() => {
    load();
  }, [load]);

  const hasTrendActivity = useMemo(
    () => (report ? report.trend.some((point) => point.totalVisits > 0) : false),
    [report]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Visit &amp; Patient Acquisition Analytics</h1>
        <p className="mt-2 text-slate-500">
          New vs returning patients, visit volume, and retention, built directly from completed
          appointments.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {REPORT_RANGE_OPTIONS.map((range) => (
          <button
            key={range}
            onClick={() => setRangeLabel(range)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              rangeLabel === range
                ? "bg-eucalyptus text-white"
                : "border border-sea-glass bg-enamel hover:bg-porcelain"
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      {rangeLabel === "Custom Range" && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
          />
          <span className="text-sm text-mineral">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
          />
        </div>
      )}

      {!resolvedPeriod ? (
        <EmptyState
          title="Select a date range"
          description="Choose both a start and end date to generate the report."
        />
      ) : loading || !report ? (
        <LoadingSpinner text="Loading Visit Analytics..." />
      ) : (
        <>
          <p className="text-sm font-medium text-mineral">
            Period: <span className="text-graphite">{report.periodLabel}</span>
          </p>

          <div>
            <h3 className="mb-4 text-lg font-bold">Summary</h3>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              <ReportStatCard title="Total Visits" value={report.totalVisits} />
              <ReportStatCard title="New Patients" value={report.newPatients} />
              <ReportStatCard title="Returning Patients" value={report.returningPatients} />
              <MetricStatCard title="Retention Rate" metric={report.retentionRate} suffix="%" />
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Acquisition</h3>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <ReportStatCard title="New Patients" value={report.newPatients} />
              <MetricStatCard title="Walk-in Visits" metric={report.walkInVisits} />
              <MetricStatCard title="Referral Patients" metric={report.referralPatients} />
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Visit Mix — New vs Returning</h3>
            <Card>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-mineral">New Patients</p>
                  <p className="mt-2 text-2xl font-bold text-graphite">{report.newPatients}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-mineral">Returning Patients</p>
                  <p className="mt-2 text-2xl font-bold text-graphite">{report.returningPatients}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-mineral">Total Visits</p>
                  <p className="mt-2 text-2xl font-bold text-graphite">{report.totalVisits}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-mineral">New Patient %</p>
                  <p className="mt-2 text-2xl font-bold text-graphite">{formatMetric(report.newPatientPercent, "%")}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-mineral">Returning Patient %</p>
                  <p className="mt-2 text-2xl font-bold text-graphite">
                    {formatMetric(report.returningPatientPercent, "%")}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs text-mineral">
                A qualifying visit is a completed appointment. New Patients and Returning Patients are
                mutually exclusive unique-patient counts; Total Visits counts every completed
                appointment, so a returning patient with multiple visits this period is still counted
                once as a patient but contributes every visit to Total Visits.
              </p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <PatientRowsTable title="New Patients" rows={report.newPatientRows} dateLabel="First Visit" />
            <PatientRowsTable
              title="Returning Patients"
              rows={report.returningPatientRows}
              dateLabel="Latest Visit This Period"
            />
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Trends</h3>
            <Card>
              <div className="mb-4">
                <p className="text-sm text-mineral">
                  {report.trendGranularity} visits, broken down by New and Returning patients.
                </p>
              </div>
              <div className="h-80">
                {hasTrendActivity ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={report.trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucketLabel" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="newPatients" name="New" stroke="#2563eb" strokeWidth={3} />
                      <Line
                        type="monotone"
                        dataKey="returningPatients"
                        name="Returning"
                        stroke="#10b981"
                        strokeWidth={3}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 text-center">
                    <p className="font-medium text-slate-500">No qualifying visits in this period</p>
                    <p className="text-sm text-slate-400">
                      Completed appointments will appear here as soon as they occur.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Walk-ins</h3>
            <Card>
              <EmptyState
                title="Walk-in tracking not available"
                description="This clinic's schema has no walk-in/booking-source field on appointments or patients. Walk-in Visits, Scheduled Visits, and Walk-in % cannot be reliably calculated from existing data. Adding a booking-source field would be a future enhancement, not something this analytics feature can retroactively infer from existing records."
              />
            </Card>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Referrals</h3>
            <Card>
              <EmptyState
                title="Referral tracking not available"
                description="This clinic's schema has no referral source field on patients or appointments, and no referrals table exists. Referred Patients, Referral Rate, and Top Referral Sources cannot be reliably calculated. Adding a referral-source field would be a future enhancement, not something this analytics feature can retroactively infer from existing records."
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function VisitAnalyticsPage() {
  return (
    <PermissionGuard permission="analytics">
      <VisitAnalyticsPageContent />
    </PermissionGuard>
  );
}
