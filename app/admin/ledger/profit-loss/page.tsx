"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp, Minus } from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getDateRange } from "@/services/analytics/dateRange";
import { getClinicSettings } from "@/services/settings";
import { getProfitAndLoss } from "@/services/ledger";
import { ProfitAndLossPeriod, ProfitAndLossSection } from "@/types/ledger";

const RANGE_OPTIONS = [
  "This Month",
  "Last Month",
  "This Quarter",
  "This Year",
  "Last Year",
  "Custom Range",
];

interface ResolvedPeriod {
  start: Date;
  end: Date;
  label: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function quarterLabel(quarterStart: Date): string {
  const quarter = Math.floor(quarterStart.getMonth() / 3) + 1;
  return `Q${quarter} ${quarterStart.getFullYear()}`;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRangeLabel(start: Date, end: Date): string {
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/**
 * The "previous equivalent period" for each named range - a full prior
 * calendar month/quarter/year for the calendar-based ranges (matching
 * this project's existing Monthly Comparison report convention of
 * comparing against a full prior calendar period), or an equal-length
 * window immediately before the range for a Custom Range.
 */
function getPreviousPeriod(rangeLabel: string, start: Date): ResolvedPeriod {
  switch (rangeLabel) {
    case "This Month": {
      const r = getDateRange("Last Month");
      return { start: r.start!, end: r.end!, label: monthLabel(r.start!) };
    }

    case "Last Month": {
      const s = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const e = new Date(start.getFullYear(), start.getMonth(), 0);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: monthLabel(s) };
    }

    case "This Quarter": {
      const s = new Date(start.getFullYear(), start.getMonth() - 3, 1);
      const e = new Date(start.getFullYear(), start.getMonth(), 0);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: quarterLabel(s) };
    }

    case "This Year": {
      const r = getDateRange("Last Year");
      return { start: r.start!, end: r.end!, label: String(r.start!.getFullYear()) };
    }

    case "Last Year": {
      const s = new Date(start.getFullYear() - 1, 0, 1);
      const e = new Date(start.getFullYear() - 1, 11, 31);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: String(s.getFullYear()) };
    }

    default:
      return { start, end: start, label: "" };
  }
}

function getPreviousCustomPeriod(start: Date, end: Date): ResolvedPeriod {
  const durationMs = end.getTime() - start.getTime();
  const e = new Date(start.getTime() - 1);
  const s = new Date(e.getTime() - durationMs);
  return { start: s, end: e, label: formatRangeLabel(s, e) };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

interface ChangeBadgeProps {
  value: number | null;
  invert?: boolean;
}

function ChangeBadge({ value, invert = false }: ChangeBadgeProps) {
  if (value == null) {
    return <span className="text-sm text-mineral">—</span>;
  }

  const isFlat = Math.abs(value) < 0.05;
  const isPositive = invert ? value < 0 : value > 0;
  const isNegative = invert ? value > 0 : value < 0;

  const colorClass = isFlat
    ? "text-mineral"
    : isPositive
      ? "text-eucalyptus"
      : isNegative
        ? "text-red-600"
        : "text-mineral";

  const Icon = isFlat ? Minus : value > 0 ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${colorClass}`}>
      <Icon size={14} />
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

interface PLSectionProps {
  title: string;
  section: ProfitAndLossSection;
  formatMoney: (amount: number) => string;
  defaultOpen?: boolean;
}

function PLSection({ title, section, formatMoney, defaultOpen = false }: PLSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-slate-200 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {title}
        </span>
        <span className="font-semibold">{formatMoney(section.total)}</span>
      </button>

      {open && (
        <div className="bg-porcelain/50 px-6 pb-4">
          {section.lines.length === 0 ? (
            <p className="py-2 text-sm text-mineral">No activity in this period.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {section.lines.map((line) => (
                  <tr key={line.accountId}>
                    <td className="py-1.5 pl-6 text-sm text-slate-600">
                      {line.accountCode} {line.accountName}
                    </td>
                    <td className="py-1.5 text-right text-sm text-slate-600">
                      {formatMoney(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function TotalRow({
  label,
  amount,
  formatMoney,
  emphasis = false,
}: {
  label: string;
  amount: number;
  formatMoney: (amount: number) => string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between border-t border-slate-200 px-6 py-4 ${
        emphasis ? "bg-porcelain text-lg font-bold" : "font-semibold"
      }`}
    >
      <span>{label}</span>
      <span>{formatMoney(amount)}</span>
    </div>
  );
}

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

  const resolvedCurrent = useMemo<ResolvedPeriod | null>(() => {
    if (rangeLabel === "Custom Range") {
      if (!customStart || !customEnd) return null;

      const start = new Date(`${customStart}T00:00:00`);
      const end = new Date(`${customEnd}T23:59:59.999`);

      return { start, end, label: formatRangeLabel(start, end) };
    }

    const { start, end } = getDateRange(rangeLabel);
    if (!start || !end) return null;

    return { start, end, label: formatRangeLabel(start, end) };
  }, [rangeLabel, customStart, customEnd]);

  const load = useCallback(async () => {
    if (!resolvedCurrent) return;

    const previousPeriod =
      rangeLabel === "Custom Range"
        ? getPreviousCustomPeriod(resolvedCurrent.start, resolvedCurrent.end)
        : getPreviousPeriod(rangeLabel, resolvedCurrent.start);

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
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to load Profit & Loss.");
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
        {RANGE_OPTIONS.map((range) => (
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
                <PLSection
                  title="Revenue"
                  section={current.revenue}
                  formatMoney={formatMoney}
                  defaultOpen
                />
                <PLSection
                  title="Cost of Sales / Direct Costs"
                  section={current.directCosts}
                  formatMoney={formatMoney}
                />
                <TotalRow
                  label="Gross Profit"
                  amount={current.grossProfit}
                  formatMoney={formatMoney}
                  emphasis
                />
                <PLSection
                  title="Operating Expenses"
                  section={current.operatingExpenses}
                  formatMoney={formatMoney}
                />
                <TotalRow label="EBIT" amount={current.ebit} formatMoney={formatMoney} />
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
                <TotalRow
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
