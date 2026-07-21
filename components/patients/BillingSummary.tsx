"use client";

import Card from "@/components/ui/Card";

interface Props {
  total: number;
  paid: number;
  outstanding: number;
  currency?: string;
}

export default function BillingSummary({
  total,
  paid,
  outstanding,
  currency = "KES",
}: Props) {
  function formatCurrency(amount: number) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  return (
    <Card title="Billing Summary">

      <div className="space-y-5">

        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">

          <div>
            <p className="text-sm text-slate-500">
              Total Billed
            </p>

            <h2 className="text-2xl font-bold">
              {formatCurrency(total)}
            </h2>
          </div>

        </div>

        <div className="flex items-center justify-between rounded-xl bg-green-50 p-4">

          <div>
            <p className="text-sm text-slate-500">
              Amount Paid
            </p>

            <h2 className="text-2xl font-bold text-green-600">
              {formatCurrency(paid)}
            </h2>
          </div>

        </div>

        <div className="flex items-center justify-between rounded-xl bg-red-50 p-4">

          <div>
            <p className="text-sm text-slate-500">
              Outstanding Balance
            </p>

            <h2 className="text-2xl font-bold text-red-600">
              {formatCurrency(outstanding)}
            </h2>
          </div>

        </div>

      </div>

    </Card>
  );
}