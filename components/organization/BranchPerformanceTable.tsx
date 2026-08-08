"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, TrendingUp, AlertTriangle } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import { OrganizationBranchPerformance } from "@/services/organizationAnalytics";

type SortKey =
  | "clinic_name"
  | "revenue"
  | "outstanding_balance"
  | "patient_count"
  | "appointment_count";

interface Column {
  key: SortKey;
  label: string;
}

const COLUMNS: Column[] = [
  { key: "clinic_name", label: "Branch" },
  { key: "revenue", label: "Revenue" },
  { key: "outstanding_balance", label: "Outstanding" },
  { key: "patient_count", label: "Patients" },
  { key: "appointment_count", label: "Appointments" },
];

interface Props {
  branches: OrganizationBranchPerformance[];
  currency: string;
  canSwitch: boolean;
  switchingId: string | null;
  onSwitch: (clinicId: string) => void;
}

export default function BranchPerformanceTable({
  branches,
  currency,
  canSwitch,
  switchingId,
  onSwitch,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDesc, setSortDesc] = useState(true);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const sorted = useMemo(() => {
    const copy = [...branches];

    copy.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDesc
          ? bValue.localeCompare(aValue)
          : aValue.localeCompare(bValue);
      }

      const diff = Number(aValue) - Number(bValue);

      return sortDesc ? -diff : diff;
    });

    return copy;
  }, [branches, sortKey, sortDesc]);

  // Simple, client-side heuristics over numbers the RPC already
  // authorized and returned - not a new data-exposure surface. "Top
  // performer" is the top 3 by revenue (excluding zero-revenue
  // branches); "Needs attention" flags a branch with money outstanding
  // but no activity in the selected range.
  const topPerformerIds = useMemo(() => {
    return new Set(
      [...branches]
        .filter((branch) => branch.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 3)
        .map((branch) => branch.clinic_id)
    );
  }, [branches]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);

  if (branches.length === 0) {
    return null;
  }

  return (
    <Card title="Branch Performance">
      <div className="max-h-[32rem] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-sea-glass text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              {COLUMNS.map((column) => (
                <th key={column.key} className="py-2 pr-4">
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className="flex items-center gap-1 hover:text-graphite"
                  >
                    {column.label}
                    <ArrowUpDown size={12} />
                  </button>
                </th>
              ))}

              {canSwitch && <th className="py-2 pr-4" />}
            </tr>
          </thead>

          <tbody>
            {sorted.map((branch) => {
              const needsAttention =
                branch.outstanding_balance > 0 &&
                branch.appointment_count === 0;

              const isTopPerformer = topPerformerIds.has(
                branch.clinic_id
              );

              return (
                <tr
                  key={branch.clinic_id}
                  className="border-b border-sea-glass/60 last:border-0"
                >
                  <td className="py-3 pr-4 font-semibold text-graphite">
                    <div className="flex items-center gap-2">
                      {branch.clinic_name}

                      {isTopPerformer && (
                        <TrendingUp
                          size={14}
                          className="text-eucalyptus"
                          aria-label="Top performer"
                        />
                      )}

                      {needsAttention && (
                        <AlertTriangle
                          size={14}
                          className="text-amber-500"
                          aria-label="Needs attention"
                        />
                      )}
                    </div>
                  </td>

                  <td className="py-3 pr-4 text-graphite">
                    {formatCurrency(branch.revenue)}
                  </td>

                  <td className="py-3 pr-4 text-graphite">
                    {formatCurrency(branch.outstanding_balance)}
                  </td>

                  <td className="py-3 pr-4 text-graphite">
                    {branch.patient_count}
                  </td>

                  <td className="py-3 pr-4 text-graphite">
                    {branch.appointment_count}
                  </td>

                  {canSwitch && (
                    <td className="py-3 pr-4 text-right">
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        disabled={switchingId !== null}
                        onClick={() => onSwitch(branch.clinic_id)}
                      >
                        {switchingId === branch.clinic_id
                          ? "Switching..."
                          : "Switch"}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
