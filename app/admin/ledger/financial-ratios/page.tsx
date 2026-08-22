"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getFinancialRatiosReport } from "@/services/financialRatios";
import { FinancialRatiosReport, RatioValue } from "@/types/financialRatios";

import { REPORT_RANGE_OPTIONS, ResolvedPeriod, resolveCurrentPeriod, shortDate } from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function RatioCard({
  title,
  ratio,
  format,
  description,
}: {
  title: string;
  ratio: RatioValue;
  format: (value: number) => string;
  description: string;
}) {
  return (
    <Card className="overflow-hidden">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">{title}</p>
      <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
        {ratio.value == null ? "Not available" : format(ratio.value)}
      </h2>
      <p className="mt-2 text-sm text-mineral">
        {ratio.value == null ? ratio.unavailableReason : description}
      </p>
    </Card>
  );
}

function formatMultiple(value: number): string {
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDays(value: number): string {
  return `${value.toFixed(1)} days`;
}

function FinancialRatiosPageContent() {
  const [loading, setLoading] = useState(true);
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [report, setReport] = useState<FinancialRatiosReport | null>(null);
  const [balanceSheetAsOfLabel, setBalanceSheetAsOfLabel] = useState("");

  const resolvedPeriod = useMemo<ResolvedPeriod | null>(
    () => resolveCurrentPeriod(rangeLabel, customStart, customEnd),
    [rangeLabel, customStart, customEnd]
  );

  const load = useCallback(async () => {
    if (!resolvedPeriod) return;

    try {
      setLoading(true);

      const data = await getFinancialRatiosReport(
        resolvedPeriod.start,
        resolvedPeriod.end,
        resolvedPeriod.label
      );

      setReport(data);
      setBalanceSheetAsOfLabel(shortDate(resolvedPeriod.end));
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load Financial Ratios."));
    } finally {
      setLoading(false);
    }
  }, [resolvedPeriod]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Financial Ratios</h1>
        <p className="mt-2 text-slate-500">
          Liquidity, profitability, leverage, and collection ratios built entirely on top of the
          existing P&amp;L, Balance Sheet, EBIT/EBITDA, and Accounts Receivable reports.
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
        <LoadingSpinner text="Loading Financial Ratios..." />
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium text-mineral">
              Period: <span className="text-graphite">{report.periodLabel}</span>
            </p>
            <p className="text-sm font-medium text-mineral">
              Balance Sheet As Of: <span className="text-graphite">{balanceSheetAsOfLabel}</span>
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Liquidity</h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <RatioCard
                title="Current Ratio"
                ratio={report.liquidity.currentRatio}
                format={formatMultiple}
                description="Measures the clinic's ability to meet short-term obligations with short-term assets."
              />
              <RatioCard
                title="Quick Ratio"
                ratio={report.liquidity.quickRatio}
                format={formatMultiple}
                description="Measures short-term liquidity using cash and receivables only, excluding inventory."
              />
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Profitability</h3>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <RatioCard
                title="Gross Margin"
                ratio={report.profitability.grossMarginPercent}
                format={formatPercent}
                description="Shows the percentage of revenue remaining after direct costs."
              />
              <RatioCard
                title="EBIT Margin"
                ratio={report.profitability.ebitMarginPercent}
                format={formatPercent}
                description="Shows operating profit as a percentage of revenue, before interest and tax."
              />
              <RatioCard
                title="EBITDA Margin"
                ratio={report.profitability.ebitdaMarginPercent}
                format={formatPercent}
                description="Shows operating profit as a percentage of revenue, before interest, tax, depreciation, and amortization."
              />
              <RatioCard
                title="Net Profit Margin"
                ratio={report.profitability.netProfitMarginPercent}
                format={formatPercent}
                description="Shows the percentage of revenue remaining after all expenses."
              />
              <RatioCard
                title="Return on Assets (ROA)"
                ratio={report.profitability.returnOnAssetsPercent}
                format={formatPercent}
                description="Shows how efficiently the clinic's assets generate profit."
              />
              <RatioCard
                title="Return on Equity (ROE)"
                ratio={report.profitability.returnOnEquityPercent}
                format={formatPercent}
                description="Shows how efficiently owner's equity generates profit."
              />
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Leverage</h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <RatioCard
                title="Debt-to-Equity"
                ratio={report.leverage.debtToEquity}
                format={formatMultiple}
                description="Shows the relationship between liabilities and equity."
              />
              <RatioCard
                title="Debt Ratio"
                ratio={report.leverage.debtRatioPercent}
                format={formatPercent}
                description="Shows the percentage of total assets financed by liabilities."
              />
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Efficiency &amp; Collection</h3>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <RatioCard
                title="Accounts Receivable Days"
                ratio={report.efficiency.accountsReceivableDays}
                format={formatDays}
                description="Shows the average number of days it takes to collect payment after billing."
              />
              <RatioCard
                title="Collection Rate"
                ratio={report.efficiency.collectionRatePercent}
                format={formatPercent}
                description="Shows the percentage of invoiced revenue actually collected in cash."
              />
              <RatioCard
                title="Accounts Payable Days"
                ratio={report.efficiency.accountsPayableDays}
                format={formatDays}
                description="Shows the average number of days the clinic takes to pay suppliers."
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FinancialRatiosPage() {
  return (
    <PermissionGuard permission="ledger">
      <FinancialRatiosPageContent />
    </PermissionGuard>
  );
}
