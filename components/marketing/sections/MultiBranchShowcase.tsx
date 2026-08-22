import { Building2 } from "lucide-react";

import FeatureRow from "@/components/marketing/FeatureRow";

const branches = [
  { name: "Westlands", staff: 8 },
  { name: "Karen", staff: 5 },
  { name: "Kilimani", staff: 6 },
  { name: "Nyali", staff: 4 },
];

function MultiBranchVisual() {
  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_24px_60px_-30px_rgba(23,85,82,0.3)]">
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 rounded-xl bg-eucalyptus px-4 py-2.5 text-white">
          <Building2 size={16} />
          <span className="text-sm font-semibold">DentalFlow Organization</span>
        </div>

        <div className="mt-3 h-6 w-px bg-sea-glass" />

        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
          {branches.map((branch) => (
            <div key={branch.name} className="flex flex-col items-center">
              <div className="h-4 w-px bg-sea-glass" />
              <div className="w-full rounded-lg border border-sea-glass bg-porcelain px-3 py-2.5 text-center">
                <p className="truncate text-sm font-semibold text-graphite">
                  {branch.name}
                </p>
                <p className="text-xs text-mineral">{branch.staff} staff</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-dashed border-sea-glass px-4 py-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
          Consolidated view
        </p>
        <p className="mt-1 text-sm text-graphite">
          Revenue, staff, and activity roll up across every branch
        </p>
      </div>
    </div>
  );
}

export default function MultiBranchShowcase() {
  return (
    <FeatureRow
      id="multi-branch"
      eyebrow="Staff & Multi-Branch Management"
      title="One organization. Every branch connected."
      description="Manage staff roles and permissions per branch, while the organization gets a consolidated view across all of them - built for groups running more than one clinic."
      visual={<MultiBranchVisual />}
    />
  );
}
