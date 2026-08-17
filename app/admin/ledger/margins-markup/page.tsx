"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getClinicSettings } from "@/services/settings";
import { getMarginsMarkupReport } from "@/services/marginsMarkup";
import { MarginsMarkupReport, TreatmentMarkupRow } from "@/types/marginsMarkup";

import { REPORT_RANGE_OPTIONS, ResolvedPeriod, resolveCurrentPeriod } from "@/lib/reports/period";

function formatPercent(value: number | null): string {
  return value == null ? "Not available" : `${value.toFixed(1)}%`;
}

function RankingCard({
  title,
  rows,
  formatMoney,
  valueLabel,
  value,
}: {
  title: string;
  rows: TreatmentMarkupRow[];
  formatMoney: (amount: number) => string;
  valueLabel: string;
  value: (row: TreatmentMarkupRow) => number;
}) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-mineral">Not enough cost data to rank treatments here.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="w-5 text-xs font-bold text-mineral">{index + 1}</span>
                {row.name}
              </span>
              <span className="font-semibold">
                {valueLabel === "currency" ? formatMoney(value(row)) : `${value(row).toFixed(1)}%`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function MarginsMarkupPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const [report, setReport] = useState<MarginsMarkupReport | null>(null);

  const resolvedPeriod = useMemo<ResolvedPeriod | null>(
    () => resolveCurrentPeriod(rangeLabel, customStart, customEnd),
    [rangeLabel, customStart, customEnd]
  );

  const load = useCallback(async () => {
    if (!resolvedPeriod) return;

    try {
      setLoading(true);

      const [clinicSettings, data] = await Promise.all([
        getClinicSettings(),
        getMarginsMarkupReport(resolvedPeriod.start, resolvedPeriod.end, resolvedPeriod.label),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setReport(data);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to load Margins & Markup.");
    } finally {
      setLoading(false);
    }
  }, [resolvedPeriod]);

  useEffect(() => {
    load();
  }, [load]);

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount),
    [currency]
  );

  const filteredTreatments = useMemo(() => {
    if (!report) return [];
    const searchLower = search.trim().toLowerCase();
    if (!searchLower) return report.treatments;
    return report.treatments.filter(
      (t) => t.name.toLowerCase().includes(searchLower) || t.category.toLowerCase().includes(searchLower)
    );
  }, [report, search]);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Margins &amp; Markup Analysis</h1>
        <p className="mt-2 text-slate-500">
          Clinic-level profitability margins and per-treatment margin/markup economics, built on
          top of the existing P&amp;L, EBIT/EBITDA, and Treatment Profitability reports.
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
        <LoadingSpinner text="Loading Margins & Markup..." />
      ) : (
        <>
          <p className="text-sm font-medium text-mineral">
            Period: <span className="text-graphite">{report.periodLabel}</span>
          </p>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Revenue" value={formatMoney(report.revenue)} />
            <StatCard title="Gross Profit" value={formatMoney(report.grossProfit)} />
            <StatCard title="Gross Margin" value={formatPercent(report.grossMarginPercent)} />
            <StatCard title="EBIT" value={formatMoney(report.ebit)} />
            <StatCard title="EBIT Margin" value={formatPercent(report.ebitMarginPercent)} />
            <StatCard title="Net Profit" value={formatMoney(report.netProfit)} />
            <StatCard title="Net Profit Margin" value={formatPercent(report.netProfitMarginPercent)} />
            <StatCard
              title="EBITDA"
              value={report.ebitdaAvailable ? formatMoney(report.ebitda!) : "Not available"}
            />
          </div>

          {report.ebitdaAvailable && (
            <StatCard title="EBITDA Margin" value={formatPercent(report.ebitdaMarginPercent)} />
          )}

          <Card>
            <button
              type="button"
              onClick={() => setExplainerOpen((o) => !o)}
              className="flex w-full items-center gap-2 text-left font-semibold"
            >
              {explainerOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Margin vs Markup — what&apos;s the difference?
            </button>

            {explainerOpen && (
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>
                  <strong>Margin</strong> is profit as a percentage of the <em>selling price</em>.{" "}
                  <strong>Markup</strong> is profit as a percentage of the <em>cost</em>. They are
                  never the same number.
                </p>
                <p className="rounded-lg bg-porcelain p-4 font-mono text-xs">
                  Cost = {formatMoney(1000)}, Selling Price = {formatMoney(1500)}
                  <br />
                  Gross Profit = {formatMoney(500)}
                  <br />
                  Margin = 500 / 1500 × 100 = 33.3%
                  <br />
                  Markup = 500 / 1000 × 100 = 50.0%
                </p>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <RankingCard
              title="Most Profitable This Period"
              rows={report.mostProfitable}
              formatMoney={formatMoney}
              valueLabel="currency"
              value={(row) => row.periodGrossProfit ?? 0}
            />
            <RankingCard
              title="Highest Margin"
              rows={report.highestMargin}
              formatMoney={formatMoney}
              valueLabel="percent"
              value={(row) => row.marginPercent ?? 0}
            />
            <RankingCard
              title="Highest Markup"
              rows={report.highestMarkup}
              formatMoney={formatMoney}
              valueLabel="percent"
              value={(row) => row.markupPercent ?? 0}
            />
            <RankingCard
              title="Lowest Margin"
              rows={report.lowestMargin}
              formatMoney={formatMoney}
              valueLabel="percent"
              value={(row) => row.marginPercent ?? 0}
            />
          </div>

          <Card title="Treatment / Service Economics">
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search treatment or category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-h-11 w-full max-w-sm rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
              />
            </div>

            {filteredTreatments.length === 0 ? (
              <EmptyState
                title="No treatments found"
                description="No treatments match the current search, or none are configured yet."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Treatment / Service</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Price</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Direct Cost</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Gross Profit</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Margin %</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Markup %</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Number Sold</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Revenue Generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTreatments.map((row) => (
                      <tr key={row.id} className="border-t border-slate-200">
                        <td className="px-6 py-4">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-xs text-mineral">{row.category}</div>
                        </td>
                        <td className="px-6 py-4 text-right">{formatMoney(row.sellingPrice)}</td>
                        <td className="px-6 py-4 text-right">
                          {row.directCost == null ? (
                            <span className="text-mineral">Not recorded</span>
                          ) : (
                            formatMoney(row.directCost)
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {row.grossProfitPerUnit == null ? "—" : formatMoney(row.grossProfitPerUnit)}
                        </td>
                        <td className="px-6 py-4 text-right">{formatPercent(row.marginPercent)}</td>
                        <td className="px-6 py-4 text-right">
                          {row.markupPercent == null ? "—" : `${row.markupPercent.toFixed(1)}%`}
                        </td>
                        <td className="px-6 py-4 text-right">{row.performedCount}</td>
                        <td className="px-6 py-4 text-right font-semibold">
                          {formatMoney(row.revenueGenerated)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-4 text-xs text-mineral">
              Price/Direct Cost/Gross Profit/Margin/Markup are the treatment&apos;s configured
              catalog figures (unaffected by sales volume); Number Sold and Revenue Generated are
              actual activity from Paid invoices in the selected period. Markup shows &quot;—&quot;
              when cost is not recorded or is recorded as exactly zero (a zero markup denominator
              is mathematically undefined, not fabricated as a number).
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

export default function MarginsMarkupPage() {
  return (
    <PermissionGuard permission="ledger">
      <MarginsMarkupPageContent />
    </PermissionGuard>
  );
}
