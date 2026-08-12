"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import ConfigureCostModal from "@/components/treatmentProfitability/ConfigureCostModal";

import usePermissions from "@/hooks/usePermissions";
import { logError } from "@/lib/logError";

import { getTreatmentProfitabilityReport } from "@/services/treatmentProfitability";
import { getClinicSettings } from "@/services/settings";

import { TreatmentProfitabilityRow } from "@/types/treatmentProfitability";

const DATE_RANGES = [
  "Today",
  "7 Days",
  "30 Days",
  "This Month",
  "This Year",
  "All Time",
];

function TreatmentProfitabilityDetailPage() {
  const params = useParams();
  const router = useRouter();

  const id = String(params.id ?? "");

  const { hasPermission } = usePermissions();
  const canManage = hasPermission("treatment_profitability_manage");

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<TreatmentProfitabilityRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [currency, setCurrency] = useState("KES");
  const [dateRange, setDateRange] = useState("All Time");
  const [configuring, setConfiguring] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [report, clinicSettings] = await Promise.all([
        getTreatmentProfitabilityReport(dateRange),
        getClinicSettings(),
      ]);

      const found = report.rows.find((item) => item.id === id) ?? null;

      setRow(found);
      setNotFound(!found);
      setCurrency(clinicSettings.currency || "KES");
    } catch (error) {
      logError("[TreatmentProfitabilityDetailPage] load failed:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load treatment profitability."
      );
    } finally {
      setLoading(false);
    }
  }, [dateRange, id]);

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

  if (loading) {
    return <LoadingSpinner text="Loading treatment profitability..." />;
  }

  if (notFound || !row) {
    return (
      <Card>
        <p className="text-slate-500">Treatment not found.</p>

        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => router.push("/admin/treatment-profitability")}
        >
          Back to Treatment Profitability
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <button
          onClick={() => router.push("/admin/treatment-profitability")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-eucalyptus hover:underline"
        >
          <ArrowLeft size={16} />
          Back to Treatment Profitability
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{row.name}</h1>
            <p className="mt-2 text-slate-500">{row.category}</p>
          </div>

          {canManage && (
            <Button onClick={() => setConfiguring(true)}>
              {row.directCost == null ? "Configure Cost" : "Edit Cost"}
            </Button>
          )}
        </div>
      </div>

      <Card title="Pricing">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Current Selling Price
            </p>
            <p className="data-metric mt-2 text-2xl font-bold text-graphite">
              {formatMoney(row.sellingPrice)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Configured Direct Cost
            </p>
            <p className="data-metric mt-2 text-2xl font-bold text-graphite">
              {row.directCost == null
                ? "Not configured"
                : formatMoney(row.directCost)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Gross Profit (per treatment)
            </p>
            <p className="data-metric mt-2 text-2xl font-bold text-graphite">
              {row.grossProfitPerUnit == null
                ? "Cost not configured"
                : formatMoney(row.grossProfitPerUnit)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Gross Margin
            </p>
            <p className="data-metric mt-2 text-2xl font-bold text-graphite">
              {row.grossMarginPerUnit == null
                ? "—"
                : `${row.grossMarginPerUnit.toFixed(1)}%`}
            </p>
          </div>
        </div>
      </Card>

      <div>
        <p className="mb-3 text-sm font-semibold text-graphite">
          Historical performance
        </p>

        <div className="flex flex-wrap gap-2">
          {DATE_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                dateRange === range
                  ? "bg-eucalyptus text-white"
                  : "border border-sea-glass bg-enamel hover:bg-porcelain"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <Card title={`Performance — ${dateRange}`}>
        {row.performedCount === 0 ? (
          <p className="text-sm text-mineral">
            This treatment wasn&apos;t billed on any paid invoice in this
            period.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Performed
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.performedCount}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Revenue
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {formatMoney(row.revenue)}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Average Selling Price
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.averageSellingPrice == null
                  ? "—"
                  : formatMoney(row.averageSellingPrice)}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Direct Costs
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.actualDirectCosts == null
                  ? "Cost not configured"
                  : formatMoney(row.actualDirectCosts)}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Gross Profit
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.actualGrossProfit == null
                  ? "Cost not configured"
                  : formatMoney(row.actualGrossProfit)}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Gross Margin
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.actualGrossMargin == null
                  ? "—"
                  : `${row.actualGrossMargin.toFixed(1)}%`}
              </p>
            </div>
          </div>
        )}
      </Card>

      <ConfigureCostModal
        open={configuring}
        treatment={row}
        currency={currency}
        onClose={() => setConfiguring(false)}
        onSaved={load}
      />
    </div>
  );
}

export default function TreatmentProfitabilityDetailPageWrapper() {
  return (
    <PermissionGuard permission="treatment_profitability">
      <TreatmentProfitabilityDetailPage />
    </PermissionGuard>
  );
}
