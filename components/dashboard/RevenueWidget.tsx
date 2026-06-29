"use client";

import Card from "@/components/ui/Card";

export default function RevenueWidget() {
  return (
    <Card title="Revenue">

      <div className="space-y-6">

        <div>

          <p className="text-sm text-slate-500">
            This Month
          </p>

          <h2 className="mt-2 text-4xl font-bold">
            KSh 0
          </h2>

        </div>

        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed">

          <p className="text-slate-500">
            Revenue chart coming soon
          </p>

        </div>

      </div>

    </Card>
  );
}