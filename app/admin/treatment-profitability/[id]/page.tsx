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
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { getTreatmentProfitabilityReport } from "@/services/treatmentProfitability";
import { getTreatmentInstanceProfitabilityForCatalogTreatment } from "@/services/treatmentInstanceProfitability";
import { getClinicSettings } from "@/services/settings";
import { getDateRange } from "@/services/analytics/dateRange";

import { TreatmentProfitabilityRow } from "@/types/treatmentProfitability";
import { TreatmentInstanceProfitability } from "@/types/treatmentInstanceProfitability";

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

  const [instances, setInstances] = useState<TreatmentInstanceProfitability[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);

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

      if (found) {
        setInstancesLoading(true);

        const { start, end } = getDateRange(dateRange);

        const instanceRows = await getTreatmentInstanceProfitabilityForCatalogTreatment(
          found.name,
          start,
          end
        );

        setInstances(instanceRows);
        setInstancesLoading(false);
      }
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to load treatment profitability.",
          "[TreatmentProfitabilityDetailPage] load failed:"
        )
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
              Estimated Catalog Cost
            </p>
            <p className="data-metric mt-2 text-2xl font-bold text-graphite">
              {row.directCost == null
                ? "Not configured"
                : formatMoney(row.directCost)}
            </p>
            <p className="mt-1 text-xs text-mineral">
              A manually configured estimate, not actual material cost - see
              Individual Treatments below for real figures.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Estimated Gross Profit (per unit)
            </p>
            <p className="data-metric mt-2 text-2xl font-bold text-graphite">
              {row.grossProfitPerUnit == null
                ? "Cost not configured"
                : formatMoney(row.grossProfitPerUnit)}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Estimated Gross Margin
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
                Estimated Direct Costs
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.estimatedDirectCosts == null
                  ? "Cost not configured"
                  : formatMoney(row.estimatedDirectCosts)}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Actual Material Cost
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {formatMoney(row.actualMaterialCost)}
              </p>
              <p className="mt-1 text-xs text-mineral">
                From materials actually recorded on this treatment
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Actual Gross Profit
              </p>
              <p className="data-metric mt-2 text-2xl font-bold text-graphite">
                {row.actualGrossProfit == null
                  ? "—"
                  : formatMoney(row.actualGrossProfit)}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                Actual Gross Margin
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

      <Card title={`Individual Treatments — ${dateRange}`}>
        <p className="mb-4 text-xs text-mineral">
          Every specific time this treatment was actually performed in this
          period, with its own revenue (recognized once invoiced - never
          fabricated for a treatment that hasn&apos;t been billed yet) and
          actual material cost (from materials recorded on that exact
          treatment, at the cost they were consumed at - never today&apos;s
          live inventory cost, never the estimate above).
        </p>

        {instancesLoading ? (
          <LoadingSpinner text="Loading individual treatments..." />
        ) : instances.length === 0 ? (
          <p className="text-sm text-mineral">
            No individual treatments recorded in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Date</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Patient</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Billing</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Revenue</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Actual Material Cost</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Gross Profit</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Gross Margin</th>
                </tr>
              </thead>

              <tbody>
                {instances.map((instance) => (
                  <tr key={instance.treatmentPlanItemId} className="border-t border-slate-200 align-top">
                    <td className="px-6 py-5 text-slate-600">
                      {new Date(instance.performedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-5 font-medium">{instance.patientName}</td>
                    <td className="px-6 py-5">
                      {instance.billingStatus === "Invoiced" ? (
                        <span className="text-xs font-medium text-green-600">
                          Invoiced{instance.invoiceNumber ? ` #${instance.invoiceNumber}` : ""}
                          {instance.invoiceStatus ? ` · ${instance.invoiceStatus}` : ""}
                        </span>
                      ) : instance.billingStatus === "Pending" ? (
                        <span className="text-xs font-medium text-amber-600">
                          Not yet invoiced
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-400">
                          Not billable
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-right font-semibold">
                      {formatMoney(instance.revenue)}
                    </td>
                    <td className="px-6 py-5 text-right">
                      {instance.materials.length === 0 ? (
                        <span className="text-slate-400">{formatMoney(0)}</span>
                      ) : (
                        <span title={instance.materials.map((m) => `${m.name}: ${m.quantity} ${m.unit} × ${formatMoney(m.unitCost)}`).join("\n")}>
                          {formatMoney(instance.actualMaterialCost)}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-right font-semibold">
                      {formatMoney(instance.grossProfit)}
                    </td>
                    <td className="px-6 py-5 text-right">
                      {instance.grossMarginPercent == null
                        ? "—"
                        : `${instance.grossMarginPercent.toFixed(2)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
