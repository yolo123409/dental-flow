"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";
import LedgerReportSection from "@/components/ledger/LedgerReportSection";
import LedgerReportTotalRow from "@/components/ledger/LedgerReportTotalRow";

import { getClinicSettings } from "@/services/settings";
import { getBalanceSheet } from "@/services/ledger";
import { BalanceSheetPeriod } from "@/types/ledger";

import { AS_OF_DATE_PRESETS, resolveAsOfDate, shortDate } from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function BalanceSheetPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [preset, setPreset] = useState("Today");
  const [customDate, setCustomDate] = useState("");

  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetPeriod | null>(null);
  const [asOfLabel, setAsOfLabel] = useState("");

  const resolvedAsOf = useMemo(() => resolveAsOfDate(preset, customDate), [preset, customDate]);

  const load = useCallback(async () => {
    if (!resolvedAsOf) return;

    try {
      setLoading(true);

      const [clinicSettings, sheet] = await Promise.all([
        getClinicSettings(),
        getBalanceSheet(resolvedAsOf),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setBalanceSheet(sheet);
      setAsOfLabel(shortDate(resolvedAsOf));
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load the Balance Sheet."));
    } finally {
      setLoading(false);
    }
  }, [resolvedAsOf]);

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
        <h1 className="mt-2 text-3xl font-bold">Balance Sheet</h1>
        <p className="mt-2 text-slate-500">
          The clinic&apos;s financial position as of a single date, built from the accounting
          ledger&apos;s own account classifications.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {AS_OF_DATE_PRESETS.map((option) => (
          <button
            key={option}
            onClick={() => setPreset(option)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              preset === option
                ? "bg-eucalyptus text-white"
                : "border border-sea-glass bg-enamel hover:bg-porcelain"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {preset === "Custom Date" && (
        <input
          type="date"
          value={customDate}
          onChange={(e) => setCustomDate(e.target.value)}
          className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
        />
      )}

      {loading || !balanceSheet ? (
        <LoadingSpinner text="Loading Balance Sheet..." />
      ) : (
        <>
          <p className="text-sm font-medium text-mineral">
            As of <span className="text-graphite">{asOfLabel}</span>
          </p>

          <div className="grid gap-6 sm:grid-cols-3">
            <StatCard title="Total Assets" value={formatMoney(balanceSheet.totalAssets)} />
            <StatCard title="Total Liabilities" value={formatMoney(balanceSheet.totalLiabilities)} />
            <StatCard title="Total Equity" value={formatMoney(balanceSheet.totalEquity)} />
          </div>

          <Card title="Assets">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <LedgerReportSection
                title="Current Assets"
                lines={balanceSheet.currentAssets.lines}
                total={balanceSheet.currentAssets.total}
                formatMoney={formatMoney}
                defaultOpen
              />
              <LedgerReportTotalRow
                label="Total Current Assets"
                amount={balanceSheet.currentAssets.total}
                formatMoney={formatMoney}
              />
              <LedgerReportSection
                title="Non-Current Assets"
                lines={balanceSheet.nonCurrentAssets.lines}
                total={balanceSheet.nonCurrentAssets.total}
                formatMoney={formatMoney}
              />
              <LedgerReportTotalRow
                label="Total Non-Current Assets"
                amount={balanceSheet.nonCurrentAssets.total}
                formatMoney={formatMoney}
              />
              <LedgerReportTotalRow
                label="Total Assets"
                amount={balanceSheet.totalAssets}
                formatMoney={formatMoney}
                emphasis
              />
            </div>
          </Card>

          <Card title="Liabilities">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <LedgerReportSection
                title="Current Liabilities"
                lines={balanceSheet.currentLiabilities.lines}
                total={balanceSheet.currentLiabilities.total}
                formatMoney={formatMoney}
                defaultOpen
              />
              <LedgerReportTotalRow
                label="Total Current Liabilities"
                amount={balanceSheet.currentLiabilities.total}
                formatMoney={formatMoney}
              />
              <LedgerReportSection
                title="Non-Current Liabilities"
                lines={balanceSheet.nonCurrentLiabilities.lines}
                total={balanceSheet.nonCurrentLiabilities.total}
                formatMoney={formatMoney}
              />
              <LedgerReportTotalRow
                label="Total Non-Current Liabilities"
                amount={balanceSheet.nonCurrentLiabilities.total}
                formatMoney={formatMoney}
              />
              <LedgerReportTotalRow
                label="Total Liabilities"
                amount={balanceSheet.totalLiabilities}
                formatMoney={formatMoney}
                emphasis
              />
            </div>
          </Card>

          <Card title="Equity">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <LedgerReportSection
                title="Equity Accounts"
                lines={balanceSheet.equityAccounts.lines}
                total={balanceSheet.equityAccounts.total}
                formatMoney={formatMoney}
                defaultOpen
              />
              <LedgerReportSection
                title="Retained Earnings (calculated)"
                lines={balanceSheet.retainedEarnings.lines}
                total={balanceSheet.retainedEarnings.total}
                formatMoney={formatMoney}
                emptyLabel="No Income or Expense activity has ever been posted, so accumulated profit is zero."
              />
              <LedgerReportTotalRow
                label="Total Equity"
                amount={balanceSheet.totalEquity}
                formatMoney={formatMoney}
                emphasis
              />
            </div>
          </Card>

          <Card>
            <LedgerReportTotalRow
              label="Total Liabilities + Equity"
              amount={balanceSheet.totalLiabilitiesAndEquity}
              formatMoney={formatMoney}
              emphasis
            />
          </Card>

          <Card title="Balance Check">
            <div className="grid gap-6 sm:grid-cols-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">Assets</p>
                <p className="mt-1 text-lg font-bold">{formatMoney(balanceSheet.totalAssets)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Liabilities + Equity
                </p>
                <p className="mt-1 text-lg font-bold">
                  {formatMoney(balanceSheet.totalLiabilitiesAndEquity)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">Difference</p>
                <p className="mt-1 text-lg font-bold">{formatMoney(balanceSheet.difference)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">Status</p>
                <div
                  className={`mt-1 flex items-center gap-2 text-lg font-bold ${
                    balanceSheet.balanced ? "text-eucalyptus" : "text-red-600"
                  }`}
                >
                  {balanceSheet.balanced ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                  {balanceSheet.balanced ? "Balanced" : "Out of Balance"}
                </div>
              </div>
            </div>
          </Card>

          <p className="text-xs text-mineral">
            Current vs Non-Current is derived from account identity (Cash/Bank/Mobile Money,
            Accounts Receivable, Inventory, and Accounts Payable are always Current; any other
            account is Current only if its name contains &quot;Current&quot;, otherwise
            Non-Current) since the Chart of Accounts has no dedicated subtype field. Retained
            Earnings is calculated as cumulative Income minus cumulative Expense as of this date -
            there is no dedicated Retained Earnings account in this system.
          </p>
        </>
      )}
    </div>
  );
}

export default function BalanceSheetPage() {
  return (
    <PermissionGuard permission="ledger">
      <BalanceSheetPageContent />
    </PermissionGuard>
  );
}
