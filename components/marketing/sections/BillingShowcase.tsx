import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import FeatureRow from "@/components/marketing/FeatureRow";
import AnimatedCounter from "@/components/marketing/AnimatedCounter";

const bars = [62, 78, 54, 88, 70, 95, 84];

function BillingVisual() {
  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_24px_60px_-30px_rgba(23,85,82,0.3)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
        This month, all branches
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-porcelain p-4">
          <p className="text-xs font-medium text-mineral">Revenue</p>
          <p className="data-metric mt-1 text-2xl font-bold text-graphite">
            <AnimatedCounter value={2480000} prefix="KES " />
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-eucalyptus">
            <ArrowUpRight size={13} /> 12% vs last month
          </p>
        </div>

        <div className="rounded-xl bg-porcelain p-4">
          <p className="text-xs font-medium text-mineral">Outstanding</p>
          <p className="data-metric mt-1 text-2xl font-bold text-graphite">
            <AnimatedCounter value={186000} prefix="KES " />
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-clay">
            <ArrowDownRight size={13} /> 4% vs last month
          </p>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
          Weekly collections
        </p>
        <div className="mt-3 flex h-24 items-end gap-2">
          {bars.map((height, index) => (
            <div
              key={index}
              className="flex-1 rounded-t-md bg-sea-glass"
              style={{ height: `${height}%` }}
            >
              <div
                className="h-1/3 w-full rounded-t-md bg-eucalyptus"
                style={{ opacity: 0.85 }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BillingShowcase() {
  return (
    <FeatureRow
      id="billing"
      eyebrow="Billing & Financial Management"
      title="Know exactly how your practice is performing."
      description="Invoicing, payments, insurance, expenses, and a full accounting ledger - connected directly to clinical activity, so the numbers always match what actually happened in the chair."
      visual={<BillingVisual />}
    />
  );
}
