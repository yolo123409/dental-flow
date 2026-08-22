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
import { getProfitAndLoss } from "@/services/ledger";
import { ProfitAndLossPeriod } from "@/types/ledger";

import {
  REPORT_RANGE_OPTIONS,
  ResolvedPeriod,
  getPreviousPeriodFor,
  percentChange,
  resolveCurrentPeriod,
} from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function ProfitAndLossPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [current, setCurrent] = useState<ProfitAndLossPeriod | null>(null);
  const [previous, setPrevious] = useState<ProfitAndLossPeriod | null>(null);
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

      const [clinicSettings, currentPL, previousPL] = await Promise.all([
        getClinicSettings(),
        getProfitAndLoss(resolvedCurrent.start, resolvedCurrent.end),
        getProfitAndLoss(previousPeriod.start, previousPeriod.end),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setCurrent(currentPL);
      setPrevious(previousPL);
      setCurrentLabel(resolvedCurrent.label);
      setPreviousLabel(previousPeriod.label);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load Profit & Loss."));
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

  const totalExpenses = current ? current.directCosts.total + current.totalOperatingExpenses : 0;
  const previousTotalExpenses = previous
    ? previous.directCosts.total + previous.totalOperatingExpenses
    : 0;

  const revenueChange = current && previous ? percentChange(current.revenue.total, previous.revenue.total) : null;
  const expenseChange =
    current && previous ? percentChange(totalExpenses, previousTotalExpenses) : null;
  const netProfitChange =
    current && previous ? percentChange(current.netProfit, previous.netProfit) : null;

  const hasActivity =
    current && (current.revenue.total !== 0 || totalExpenses !== 0 || current.directCosts.total !== 0);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Profit & Loss</h1>
        <p className="mt-2 text-slate-500">
          Revenue, direct costs, and operating expenses for the selected period, built from the
          accounting ledger&apos;s own account classifications.
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
        <LoadingSpinner text="Loading Profit & Loss..." />
      ) : (
        <>
          <p className="text-sm font-medium text-mineral">
            Showing <span className="text-graphite">{currentLabel}</span>
          </p>

          <div className="grid gap-6 sm:grid-cols-3">
            <StatCard
              title="Revenue"
              value={formatMoney(current.revenue.total)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
            <StatCard
              title="Total Expenses"
              value={formatMoney(totalExpenses)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
            <StatCard
              title="Net Profit"
              value={formatMoney(current.netProfit)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
          </div>

          <Card title={`${currentLabel} vs ${previousLabel}`}>
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Revenue Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={revenueChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Expense Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={expenseChange} invert />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Net Profit Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={netProfitChange} />
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
            <Card>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <LedgerReportSection
                  title="Revenue"
                  lines={current.revenue.lines}
                  total={current.revenue.total}
                  formatMoney={formatMoney}
                  defaultOpen
                />
                <LedgerReportSection
                  title="Cost of Sales / Direct Costs"
                  lines={current.directCosts.lines}
                  total={current.directCosts.total}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="Gross Profit"
                  amount={current.grossProfit}
                  formatMoney={formatMoney}
                  emphasis
                />
                <LedgerReportSection
                  title="Operating Expenses"
                  lines={current.operatingExpenses.lines}
                  total={current.operatingExpenses.total}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow label="EBIT" amount={current.ebit} formatMoney={formatMoney} />
                <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
                  <span className="font-semibold">EBITDA</span>
                  <span className="font-semibold">
                    {current.ebitda != null ? (
                      formatMoney(current.ebitda)
                    ) : (
                      <span className="text-sm font-normal text-mineral">
                        Not available — no Depreciation/Amortization account in the Chart of
                        Accounts
                      </span>
                    )}
                  </span>
                </div>
                <LedgerReportTotalRow
                  label="Net Profit"
                  amount={current.netProfit}
                  formatMoney={formatMoney}
                  emphasis
                />
              </div>
            </Card>
          )}

          {current.ebit === current.netProfit && (
            <p className="text-xs text-mineral">
              EBIT and Net Profit are currently the same figure because this clinic&apos;s Chart
              of Accounts does not yet distinguish Interest or Tax expense accounts.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function ProfitAndLossPage() {
  return (
    <PermissionGuard permission="ledger">
      <ProfitAndLossPageContent />
    </PermissionGuard>
  );
}
