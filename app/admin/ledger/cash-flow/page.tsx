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
import { getCashFlowStatement } from "@/services/ledger";
import { CashFlowPeriod } from "@/types/ledger";

import {
  REPORT_RANGE_OPTIONS,
  ResolvedPeriod,
  getPreviousPeriodFor,
  percentChange,
  resolveCurrentPeriod,
} from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function CashFlowPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [current, setCurrent] = useState<CashFlowPeriod | null>(null);
  const [previous, setPrevious] = useState<CashFlowPeriod | null>(null);
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

      const [clinicSettings, currentCF, previousCF] = await Promise.all([
        getClinicSettings(),
        getCashFlowStatement(resolvedCurrent.start, resolvedCurrent.end),
        getCashFlowStatement(previousPeriod.start, previousPeriod.end),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setCurrent(currentCF);
      setPrevious(previousCF);
      setCurrentLabel(resolvedCurrent.label);
      setPreviousLabel(previousPeriod.label);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load Cash Flow Statement."));
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

  const operatingChange =
    current && previous ? percentChange(current.operating.total, previous.operating.total) : null;
  const investingChange =
    current && previous ? percentChange(current.investing.total, previous.investing.total) : null;
  const financingChange =
    current && previous ? percentChange(current.financing.total, previous.financing.total) : null;
  const netChange =
    current && previous ? percentChange(current.netChangeInCash, previous.netChangeInCash) : null;

  const hasActivity =
    current &&
    (current.operating.total !== 0 ||
      current.investing.total !== 0 ||
      current.financing.total !== 0 ||
      current.other.total !== 0);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Cash Flow Statement</h1>
        <p className="mt-2 text-slate-500">
          Actual cash movements for the selected period, classified by what each transaction
          posted against in the accounting ledger - not accrual revenue or expenses.
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
        <LoadingSpinner text="Loading Cash Flow Statement..." />
      ) : (
        <>
          <p className="text-sm font-medium text-mineral">
            Showing <span className="text-graphite">{currentLabel}</span>
          </p>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Net Cash from Operating"
              value={formatMoney(current.operating.total)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
            <StatCard
              title="Net Cash from Investing"
              value={formatMoney(current.investing.total)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
            <StatCard
              title="Net Cash from Financing"
              value={formatMoney(current.financing.total)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
            <StatCard
              title="Net Change in Cash"
              value={formatMoney(current.netChangeInCash)}
              subtitle={`${currentLabel} vs ${previousLabel}`}
            />
          </div>

          <Card title={`${currentLabel} vs ${previousLabel}`}>
            <div className="grid gap-6 sm:grid-cols-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Operating Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={operatingChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Investing Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={investingChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Financing Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={financingChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Net Cash Change
                </p>
                <div className="mt-2">
                  <ChangeBadge value={netChange} />
                </div>
              </div>
            </div>
          </Card>

          {!hasActivity ? (
            <Card>
              <EmptyState
                title="No cash activity in this period"
                description="No transactions posted against a Cash, Bank, or Mobile Money account for this date range."
              />
            </Card>
          ) : (
            <Card>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <LedgerReportSection
                  title="Operating Activities"
                  lines={current.operating.lines}
                  total={current.operating.total}
                  formatMoney={formatMoney}
                  defaultOpen
                />
                <LedgerReportTotalRow
                  label="Net Cash from Operating Activities"
                  amount={current.operating.total}
                  formatMoney={formatMoney}
                  emphasis
                />

                <LedgerReportSection
                  title="Investing Activities"
                  lines={current.investing.lines}
                  total={current.investing.total}
                  formatMoney={formatMoney}
                  emptyLabel={
                    current.hasInvestingCapability
                      ? "No activity in this period."
                      : "No Fixed Asset/Equipment-type account exists in the Chart of Accounts yet, so no Investing Activities can be shown."
                  }
                />
                <LedgerReportTotalRow
                  label="Net Cash from Investing Activities"
                  amount={current.investing.total}
                  formatMoney={formatMoney}
                  emphasis
                />

                <LedgerReportSection
                  title="Financing Activities"
                  lines={current.financing.lines}
                  total={current.financing.total}
                  formatMoney={formatMoney}
                  emptyLabel={
                    current.hasFinancingCapability
                      ? "No activity in this period."
                      : "No Loan or Owner's Equity-type account is currently used for cash transactions, so no Financing Activities can be shown."
                  }
                />
                <LedgerReportTotalRow
                  label="Net Cash from Financing Activities"
                  amount={current.financing.total}
                  formatMoney={formatMoney}
                  emphasis
                />

                {current.other.total !== 0 && (
                  <>
                    <LedgerReportSection
                      title="Other Reconciling Items"
                      lines={current.other.lines}
                      total={current.other.total}
                      formatMoney={formatMoney}
                    />
                  </>
                )}

                <LedgerReportTotalRow
                  label="Net Change in Cash"
                  amount={current.netChangeInCash}
                  formatMoney={formatMoney}
                  emphasis
                />
                <LedgerReportTotalRow
                  label="Beginning Cash Balance"
                  amount={current.beginningCash}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="Ending Cash Balance"
                  amount={current.endingCash}
                  formatMoney={formatMoney}
                  emphasis
                />
              </div>
            </Card>
          )}

          <div className="space-y-1 text-xs text-mineral">
            {current.other.total !== 0 && (
              <p>
                &quot;Other Reconciling Items&quot; is a historical Opening Balance entry dated
                inside this period - a balance-forward declaration, not a real cash inflow or
                outflow, so it is kept separate from Operating/Investing/Financing rather than
                misclassified as one of them.
              </p>
            )}
            {!current.hasInvestingCapability && (
              <p>
                Investing Activities requires a dedicated Fixed Asset/Equipment-type account in
                the Chart of Accounts - add one (e.g. &quot;Equipment&quot;, type Asset) and post
                purchases against it to track this going forward.
              </p>
            )}
            {!current.hasFinancingCapability && (
              <p>
                Financing Activities requires a Loan or Owner&apos;s Equity-type account to be
                used for cash transactions - record loans, repayments, or owner
                contributions/withdrawals via a Manual Journal Entry against such an account (the
                existing Owner&apos;s Equity account, or a custom Loan Payable account) to track
                this going forward.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function CashFlowPage() {
  return (
    <PermissionGuard permission="ledger">
      <CashFlowPageContent />
    </PermissionGuard>
  );
}
