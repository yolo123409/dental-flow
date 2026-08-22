"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";
import ChangeBadge from "@/components/ledger/ChangeBadge";
import LedgerReportSection from "@/components/ledger/LedgerReportSection";
import LedgerReportTotalRow from "@/components/ledger/LedgerReportTotalRow";

import { getClinicSettings } from "@/services/settings";
import { getEbitEbitda } from "@/services/ledger";
import { EbitEbitdaPeriod } from "@/types/ledger";

import {
  REPORT_RANGE_OPTIONS,
  ResolvedPeriod,
  getPreviousPeriodFor,
  percentChange,
  resolveCurrentPeriod,
} from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function formatPercent(value: number | null): string {
  return value == null ? "N/A" : `${value.toFixed(1)}%`;
}

function EbitEbitdaPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [current, setCurrent] = useState<EbitEbitdaPeriod | null>(null);
  const [previous, setPrevious] = useState<EbitEbitdaPeriod | null>(null);
  const [currentLabel, setCurrentLabel] = useState("");
  const [previousLabel, setPreviousLabel] = useState("");

  const resolvedCurrent = useMemo<ResolvedPeriod | null>(
    () => resolveCurrentPeriod(rangeLabel, customStart, customEnd),
    [rangeLabel, customStart, customEnd]
  );

  const load = useCallback(async () => {
    if (!resolvedCurrent) return;

    const previousPeriod = getPreviousPeriodFor(rangeLabel, resolvedCurrent);

    try {
      setLoading(true);

      const [clinicSettings, currentReport, previousReport] = await Promise.all([
        getClinicSettings(),
        getEbitEbitda(resolvedCurrent.start, resolvedCurrent.end),
        getEbitEbitda(previousPeriod.start, previousPeriod.end),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setCurrent(currentReport);
      setPrevious(previousReport);
      setCurrentLabel(resolvedCurrent.label);
      setPreviousLabel(previousPeriod.label);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load EBIT/EBITDA."));
    } finally {
      setLoading(false);
    }
  }, [resolvedCurrent, rangeLabel]);

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

  const revenueChange = current && previous ? percentChange(current.revenue, previous.revenue) : null;
  const ebitChange = current && previous ? percentChange(current.ebit, previous.ebit) : null;
  const ebitdaChange =
    current && previous && current.ebitdaAvailable && previous.ebitdaAvailable && current.ebitda !== null && previous.ebitda !== null
      ? percentChange(current.ebitda, previous.ebitda)
      : null;
  const ebitMarginChange =
    current && previous && current.ebitMarginPercent !== null && previous.ebitMarginPercent !== null
      ? percentChange(current.ebitMarginPercent, previous.ebitMarginPercent)
      : null;
  const ebitdaMarginChange =
    current &&
    previous &&
    current.ebitdaMarginPercent !== null &&
    previous.ebitdaMarginPercent !== null
      ? percentChange(current.ebitdaMarginPercent, previous.ebitdaMarginPercent)
      : null;

  const hasActivity = current && (current.revenue !== 0 || current.operatingExpenses.total !== 0 || current.directCosts !== 0);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">EBIT / EBITDA Analysis</h1>
        <p className="mt-2 text-slate-500">
          Operating profitability for the selected period, built directly on top of the Profit
          &amp; Loss report&apos;s own Revenue, Direct Costs, and Gross Profit figures.
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

      {!resolvedCurrent ? (
        <EmptyState
          title="Select a date range"
          description="Choose both a start and end date to generate the report."
        />
      ) : loading || !current || !previous ? (
        <LoadingSpinner text="Loading EBIT/EBITDA..." />
      ) : (
        <>
          <p className="text-sm font-medium text-mineral">
            Showing <span className="text-graphite">{currentLabel}</span>
          </p>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard title="Revenue" value={formatMoney(current.revenue)} />
            <StatCard title="Gross Profit" value={formatMoney(current.grossProfit)} />
            <StatCard title="EBIT" value={formatMoney(current.ebit)} />
            <StatCard title="EBIT Margin" value={formatPercent(current.ebitMarginPercent)} />
            <StatCard
              title="EBITDA"
              value={current.ebitdaAvailable ? formatMoney(current.ebitda!) : "Not available"}
            />
            <StatCard
              title="EBITDA Margin"
              value={current.ebitdaAvailable ? formatPercent(current.ebitdaMarginPercent) : "Not available"}
            />
          </div>

          <Card title={`${currentLabel} vs ${previousLabel}`}>
            <div className="grid gap-6 sm:grid-cols-3 xl:grid-cols-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">Revenue</p>
                <div className="mt-2">
                  <ChangeBadge value={revenueChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">EBIT</p>
                <div className="mt-2">
                  <ChangeBadge value={ebitChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">EBITDA</p>
                <div className="mt-2">
                  <ChangeBadge value={ebitdaChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  EBIT Margin
                </p>
                <div className="mt-2">
                  <ChangeBadge value={ebitMarginChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  EBITDA Margin
                </p>
                <div className="mt-2">
                  <ChangeBadge value={ebitdaMarginChange} />
                </div>
              </div>
            </div>
          </Card>

          {!hasActivity ? (
            <Card>
              <EmptyState
                title="No financial activity in this period"
                description="No revenue, direct costs, or operating expenses were posted to the ledger for this date range."
              />
            </Card>
          ) : (
            <Card title="Profitability Bridge">
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <LedgerReportTotalRow label="Revenue" amount={current.revenue} formatMoney={formatMoney} />
                <LedgerReportTotalRow
                  label="− Direct Costs"
                  amount={-current.directCosts}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="= Gross Profit"
                  amount={current.grossProfit}
                  formatMoney={formatMoney}
                  emphasis
                />
                <LedgerReportSection
                  title="− Operating Expenses"
                  lines={current.operatingExpenses.lines}
                  total={-current.operatingExpenses.total}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="= EBIT"
                  amount={current.ebit}
                  formatMoney={formatMoney}
                  emphasis
                />
                <LedgerReportSection
                  title="+ Depreciation"
                  lines={current.depreciation.lines}
                  total={current.depreciation.total}
                  formatMoney={formatMoney}
                  emptyLabel="Not recorded - no Depreciation account has activity this period."
                />
                <LedgerReportSection
                  title="+ Amortization"
                  lines={current.amortization.lines}
                  total={current.amortization.total}
                  formatMoney={formatMoney}
                  emptyLabel="Not recorded - no Amortization account has activity this period."
                />
                {current.ebitdaAvailable ? (
                  <LedgerReportTotalRow
                    label="= EBITDA"
                    amount={current.ebitda!}
                    formatMoney={formatMoney}
                    emphasis
                  />
                ) : (
                  <div className="flex items-center justify-between border-t border-slate-200 bg-porcelain px-6 py-4 text-lg font-bold">
                    <span>= EBITDA</span>
                    <span className="text-sm font-normal text-mineral">
                      Not available — Depreciation and Amortization are not currently recorded in
                      this clinic&apos;s Chart of Accounts
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="Interest &amp; Tax">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <LedgerReportSection
                title="Interest Expense"
                lines={current.interestExpense.lines}
                total={current.interestExpense.total}
                formatMoney={formatMoney}
                emptyLabel="No interest expense recorded."
              />
              <LedgerReportSection
                title="Tax Expense"
                lines={current.taxExpense.lines}
                total={current.taxExpense.total}
                formatMoney={formatMoney}
                emptyLabel="No tax expense recorded."
              />
            </div>
            <p className="mt-4 text-xs text-mineral">
              Both are informational only - EBIT and EBITDA are already defined as being before
              interest and taxes, so any account identified here is already excluded from
              Operating Expenses above, not subtracted again.
            </p>
          </Card>

          {current.interestExpense.lines.length === 0 && current.taxExpense.lines.length === 0 && (
            <p className="text-xs text-mineral">
              No Interest or Tax account exists in this clinic&apos;s Chart of Accounts, so EBIT
              above is byte-identical to the Profit &amp; Loss report&apos;s own EBIT for the same
              period.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function EbitEbitdaPage() {
  return (
    <PermissionGuard permission="ledger">
      <EbitEbitdaPageContent />
    </PermissionGuard>
  );
}
