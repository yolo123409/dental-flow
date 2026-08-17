"use client";

import { useMemo } from "react";
import Link from "next/link";

import Card from "@/components/ui/Card";

import { roundMoney } from "@/lib/currency";

interface NetPositionWidgetProps {
  revenue: number;
  moneyOut: number;
  // Break-even revenue for the selected period - equal to Total Costs
  // Incurred (`moneyOut`) itself, since that's the revenue level at which
  // Total Revenue - Total Costs Incurred = 0. NULL = Total Costs Incurred
  // could not be determined for this period - never treated as 0. Same
  // convention as RevenueWidget's breakEven prop.
  breakEven: number | null;
  currency: string;
  loading: boolean;
  error: string | null;
}

export default function NetPositionWidget({
  revenue,
  moneyOut,
  breakEven,
  currency,
  loading,
  error,
}: NetPositionWidgetProps) {
  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  // "Net Operating Position", never "Net Profit" - DentalFlow doesn't
  // account for tax, depreciation, accruals, or financing, so calling
  // this "profit" would overstate what the number actually represents.
  const position = useMemo(() => {
    const net = roundMoney(revenue - moneyOut);

    if (net < 0) {
      return {
        kind: "deficit" as const,
        label: `Operating deficit of ${formatMoney(Math.abs(net))}`,
        net,
      };
    }

    if (net === 0) {
      return {
        kind: "even" as const,
        label: "Revenue equals recorded expenses",
        net,
      };
    }

    return {
      kind: "positive" as const,
      label: `${formatMoney(net)} above recorded expenses`,
      net,
    };
    // formatMoney is a plain closure off of `currency`, not stable state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenue, moneyOut, currency]);

  const colorClasses = {
    deficit: "text-clay",
    even: "text-slate-600",
    positive: "text-eucalyptus",
  } as const;

  return (
    <Card title="Money Out">
      <div className="space-y-6">
        <div>
          <p className="text-sm text-slate-500">This Month</p>

          <h2 className="mt-2 text-4xl font-bold">
            {loading ? "..." : error ? "—" : formatMoney(moneyOut)}
          </h2>

          <Link
            href="/admin/money-out"
            className="mt-2 inline-block text-sm font-semibold text-eucalyptus hover:underline"
          >
            View Money Out
          </Link>
        </div>

        {!loading && !error && (
          <div className="border-t border-sea-glass pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-mineral">
              Net Operating Position
            </p>

            <p className={`mt-2 text-2xl font-bold ${colorClasses[position.kind]}`}>
              {formatMoney(position.net)}
            </p>

            <p className="mt-1 text-sm text-slate-500">{position.label}</p>

            <p className="mt-1 text-xs text-slate-500">
              Break-even revenue: {breakEven == null ? "Not available" : formatMoney(breakEven)}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
