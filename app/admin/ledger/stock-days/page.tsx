"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";
import LedgerReportTotalRow from "@/components/ledger/LedgerReportTotalRow";

import { getClinicSettings } from "@/services/settings";
import { getStockDaysReport } from "@/services/stockDays";
import { MetricValue, StockDaysReport } from "@/types/stockDays";

import { REPORT_RANGE_OPTIONS, ResolvedPeriod, resolveCurrentPeriod, shortDate } from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function MetricCard({
  title,
  metric,
  format,
  description,
}: {
  title: string;
  metric: MetricValue;
  format: (value: number) => string;
  description: string;
}) {
  return (
    <Card className="overflow-hidden">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">{title}</p>
      <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
        {metric.value == null ? "Not available" : format(metric.value)}
      </h2>
      <p className="mt-2 text-sm text-mineral">
        {metric.value == null ? metric.unavailableReason : description}
      </p>
    </Card>
  );
}

function formatDays(value: number): string {
  return `${value.toFixed(1)} days`;
}

function formatMultiple(value: number): string {
  return `${value.toFixed(2)}x`;
}

function StockDaysPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [report, setReport] = useState<StockDaysReport | null>(null);
  const [balanceSheetAsOfLabel, setBalanceSheetAsOfLabel] = useState("");

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
        getStockDaysReport(resolvedPeriod.start, resolvedPeriod.end, resolvedPeriod.label),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setReport(data);
      setBalanceSheetAsOfLabel(shortDate(resolvedPeriod.end));
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load Stock Days."));
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

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Stock Days / Inventory Days</h1>
        <p className="mt-2 text-slate-500">
          Estimates how many days of inventory the clinic holds based on its inventory level and
          rate of consumption, built entirely on top of the existing Balance Sheet and P&amp;L
          reports.
        </p>
        <Link
          href="/admin/inventory"
          className="mt-2 inline-block text-sm font-medium text-eucalyptus hover:underline"
        >
          View Inventory →
        </Link>
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
        <LoadingSpinner text="Loading Stock Days..." />
      ) : !report.inventoryAccountConfigured ? (
        <Card>
          <EmptyState
            title="Inventory account not configured"
            description="This clinic's Chart of Accounts has no Inventory account configured in Ledger Settings, so Stock Days cannot be reliably calculated. Configure an Inventory account first."
          />
        </Card>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium text-mineral">
              Period: <span className="text-graphite">{report.periodLabel}</span>
            </p>
            <p className="text-sm font-medium text-mineral">
              Days: <span className="text-graphite">{report.periodDays}</span>
            </p>
            <p className="text-sm font-medium text-mineral">
              Balance Sheet As Of: <span className="text-graphite">{balanceSheetAsOfLabel}</span>
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Stock Days"
              metric={report.inventoryDays}
              format={formatDays}
              description="Approximately how many days the current inventory would cover at this period's rate of consumption."
            />
            <MetricCard
              title="Inventory Turnover"
              metric={report.inventoryTurnover}
              format={formatMultiple}
              description="How many times inventory was consumed and replaced during this period."
            />
            <MetricCard
              title="Ending Inventory"
              metric={report.endingInventory}
              format={formatMoney}
              description="Ledger Inventory account balance as of the period end - the same figure the Balance Sheet report shows."
            />
            <MetricCard
              title="Average Inventory"
              metric={report.averageInventory}
              format={formatMoney}
              description="(Beginning Inventory + Ending Inventory) / 2."
            />
            <MetricCard
              title="Inventory Consumption / COGS"
              metric={report.costOfGoodsSold}
              format={formatMoney}
              description="The Supplies Used account's activity for this period - the same Direct Costs figure shown on the P&L."
            />
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold">Inventory Position</h3>
            <Card>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <LedgerReportTotalRow
                  label="Beginning Inventory"
                  amount={report.beginningInventory.value ?? 0}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="Ending Inventory"
                  amount={report.endingInventory.value ?? 0}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="Average Inventory"
                  amount={report.averageInventory.value ?? 0}
                  formatMoney={formatMoney}
                  emphasis
                />
              </div>
            </Card>
          </div>

          {report.movement && (
            <div>
              <h3 className="mb-4 text-lg font-bold">Inventory Movement</h3>
              <Card>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <LedgerReportTotalRow
                    label="Opening Stock"
                    amount={report.movement.openingStock}
                    formatMoney={formatMoney}
                  />
                  <LedgerReportTotalRow
                    label="+ Purchases / Stock Received"
                    amount={report.movement.purchases}
                    formatMoney={formatMoney}
                  />
                  <LedgerReportTotalRow
                    label="− Inventory Consumed"
                    amount={-report.movement.consumed}
                    formatMoney={formatMoney}
                  />
                  {report.movement.returnedToSupplier !== 0 && (
                    <LedgerReportTotalRow
                      label="− Returned to Supplier"
                      amount={-report.movement.returnedToSupplier}
                      formatMoney={formatMoney}
                    />
                  )}
                  {report.movement.other !== 0 && (
                    <LedgerReportTotalRow
                      label="+/− Other Ledger Activity"
                      amount={report.movement.other}
                      formatMoney={formatMoney}
                    />
                  )}
                  <LedgerReportTotalRow
                    label="= Closing Stock (computed)"
                    amount={report.movement.computedClosingStock}
                    formatMoney={formatMoney}
                    emphasis
                  />
                  <LedgerReportTotalRow
                    label="Closing Stock (ledger balance)"
                    amount={report.movement.closingStock}
                    formatMoney={formatMoney}
                    emphasis
                  />
                </div>

                {report.movement.reconciles ? (
                  <p className="mt-4 text-xs text-mineral">
                    The computed closing stock matches the ledger&apos;s own Ending Inventory
                    balance exactly.
                  </p>
                ) : (
                  <p className="mt-4 text-sm font-medium text-amber-600">
                    Discrepancy of {formatMoney(report.movement.discrepancy)} between the computed
                    and actual closing stock - this is shown as-is, not forced to match.
                  </p>
                )}
              </Card>
            </div>
          )}

          <div>
            <h3 className="mb-4 text-lg font-bold">Reconciliation</h3>
            <Card>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <LedgerReportTotalRow
                  label="Ledger Inventory Balance (now)"
                  amount={report.reconciliation.ledgerValueNow}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="Live Operational Stock Value (now)"
                  amount={report.reconciliation.liveOperationalValueNow}
                  formatMoney={formatMoney}
                />
                <LedgerReportTotalRow
                  label="Difference"
                  amount={report.reconciliation.difference}
                  formatMoney={formatMoney}
                  emphasis
                />
              </div>
              <p className="mt-4 text-xs text-mineral">
                Both figures are as of right now, not the selected period end - the Inventory
                module only reflects current stock, so this is the only honest comparison
                regardless of which report period is selected above.{" "}
                {report.reconciliation.matches
                  ? "They currently match."
                  : "They currently differ - this can happen when stock is adjusted via a manual Restock/Correction, which intentionally isn't posted to the ledger (there is no reliable funding source to balance it against)."}
              </p>
            </Card>
          </div>

          <Card title="Interpretation">
            <p className="text-sm text-slate-600">
              Stock Days estimates how many days of inventory are held based on the clinic&apos;s
              current inventory level and its rate of inventory consumption. It does not indicate
              whether that level is appropriate for this clinic - the right amount of stock cover
              depends on supplier lead times, storage constraints, and expiry risk, which vary by
              clinic and material.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

export default function StockDaysPage() {
  return (
    <PermissionGuard permission="ledger">
      <StockDaysPageContent />
    </PermissionGuard>
  );
}
