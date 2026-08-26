"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import CeoGuard from "@/components/auth/CeoGuard";
import useOrganization from "@/hooks/useOrganization";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

import { getOrganizationFinancials } from "@/services/organizations";
import { logError } from "@/lib/logError";
import { REPORT_RANGE_OPTIONS, resolveCurrentPeriod, ResolvedPeriod } from "@/lib/reports/period";

import { OrganizationFinancials } from "@/types/organization";

function formatPercent(value: number | null): string {
  return value == null ? "Not available" : `${value.toFixed(1)}%`;
}

function OrganizationFinancialsContent() {
  const { organizationUser } = useOrganization();

  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [financials, setFinancials] = useState<OrganizationFinancials | null>(null);
  const [loading, setLoading] = useState(true);

  const resolvedPeriod = useMemo<ResolvedPeriod | null>(
    () => resolveCurrentPeriod(rangeLabel, customStart, customEnd),
    [rangeLabel, customStart, customEnd]
  );

  const load = useCallback(async () => {
    if (!organizationUser || !resolvedPeriod) return;

    try {
      setLoading(true);

      const data = await getOrganizationFinancials(
        organizationUser.organization_id,
        resolvedPeriod.start,
        resolvedPeriod.end
      );

      setFinancials(data);
    } catch (error) {
      logError(
        "[Organization financials page] Failed to load financials:",
        error
      );

      toast.error("Unable to load consolidated financials.");
    } finally {
      setLoading(false);
    }
  }, [organizationUser, resolvedPeriod]);

  useEffect(() => {
    void load();
  }, [load]);

  const formatMoney = useMemo(
    () => (amount: number, currency: string) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount),
    []
  );

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-4xl font-bold tracking-tight">
          Consolidated Financials
        </h1>

        <p className="mt-2 text-mineral">
          Revenue, expenses, and operating profitability across every
          branch. Balance Sheet, Cash Flow, and financial ratios aren&apos;t
          consolidated here yet - view those per branch from the Ledger.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {REPORT_RANGE_OPTIONS.map((range) => (
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

      {!resolvedPeriod ? (
        <EmptyState
          title="Select a date range"
          description="Choose both a start and end date to generate the report."
        />
      ) : loading || !financials ? (
        <LoadingSpinner text="Loading consolidated financials..." />
      ) : financials.branches.length === 0 ? (
        <EmptyState
          title="No branches yet"
          description="Consolidated financials will appear once your organization has at least one branch."
        />
      ) : !financials.currencyConsistent ? (
        <Card>
          <div className="flex gap-4">
            <AlertTriangle className="mt-1 shrink-0 text-amber-600" size={24} />

            <div>
              <h3 className="font-semibold text-graphite">
                Branches use different currencies
              </h3>

              <p className="mt-2 text-sm text-mineral">
                A consolidated total can&apos;t be shown because your
                branches aren&apos;t all using the same currency (this app
                doesn&apos;t convert between currencies). Update each
                branch&apos;s currency in Settings to match if they should
                be combined, or review each branch&apos;s figures below
                individually.
              </p>

              <div className="mt-4 space-y-2">
                {financials.branchCurrencies.map((branch) => (
                  <div
                    key={branch.clinic_id}
                    className="flex items-center justify-between rounded-lg border border-sea-glass px-4 py-2 text-sm"
                  >
                    <span className="text-graphite">{branch.clinic_name}</span>
                    <span className="font-semibold text-mineral">{branch.currency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-bold text-graphite">
              Revenue, Expenses &amp; Profit
            </h2>

            <p className="mt-1 text-sm text-mineral">
              Based on each branch&apos;s own accounting ledger - the same
              figures its Ledger P&amp;L page would show, summed across
              every branch.
            </p>

            <div className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                title="Revenue"
                value={formatMoney(financials.revenue, financials.currency!)}
              />
              <StatCard
                title="Direct Costs"
                value={formatMoney(financials.directCosts, financials.currency!)}
              />
              <StatCard
                title="Gross Profit"
                value={formatMoney(financials.grossProfit, financials.currency!)}
              />
              <StatCard
                title="Gross Margin"
                value={formatPercent(financials.grossMarginPercent)}
              />
              <StatCard
                title="Expenses"
                value={formatMoney(financials.expenses, financials.currency!)}
              />
              <StatCard
                title="Net Profit"
                value={formatMoney(financials.netProfit, financials.currency!)}
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold text-graphite">
              Operating Profitability (Ledger-based)
            </h2>

            <p className="mt-1 text-sm text-mineral">
              EBIT/EBITDA are computed from each branch&apos;s accounting
              ledger, a separate calculation from the Revenue/Expenses/Profit
              figures above - the two are independently correct and aren&apos;t
              expected to match exactly, the same as on each branch&apos;s own
              Ledger pages.
            </p>

            <div className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                title="EBIT"
                value={formatMoney(financials.ebit, financials.currency!)}
              />
              <StatCard
                title="EBITDA"
                value={
                  financials.ebitdaAvailable
                    ? formatMoney(financials.ebitda!, financials.currency!)
                    : "Not available"
                }
                subtitle={
                  financials.ebitdaBranchesTotal > 0
                    ? `${financials.ebitdaBranchesIncluded} of ${financials.ebitdaBranchesTotal} branches contributed`
                    : undefined
                }
              />
            </div>
          </div>

          <Card title="By Branch">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sea-glass text-left text-xs font-bold uppercase tracking-wide text-mineral">
                    <th className="py-3 pr-4">Branch</th>
                    <th className="py-3 pr-4">Revenue</th>
                    <th className="py-3 pr-4">Expenses</th>
                    <th className="py-3 pr-4">Net Profit</th>
                    <th className="py-3 pr-4">EBIT</th>
                    <th className="py-3">EBITDA</th>
                  </tr>
                </thead>

                <tbody>
                  {financials.branches.map((branch) => (
                    <tr key={branch.clinic_id} className="border-b border-sea-glass last:border-0">
                      <td className="py-3 pr-4 font-medium text-graphite">
                        {branch.clinic_name}
                      </td>
                      <td className="py-3 pr-4">{formatMoney(branch.revenue, branch.currency)}</td>
                      <td className="py-3 pr-4">{formatMoney(branch.expenses, branch.currency)}</td>
                      <td className="py-3 pr-4">{formatMoney(branch.netProfit, branch.currency)}</td>
                      <td className="py-3 pr-4">{formatMoney(branch.ebit, branch.currency)}</td>
                      <td className="py-3">
                        {branch.ebitdaAvailable
                          ? formatMoney(branch.ebitda!, branch.currency)
                          : "Not available"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

    </div>
  );
}

export default function OrganizationFinancialsPage() {
  return (
    <CeoGuard>
      <OrganizationFinancialsContent />
    </CeoGuard>
  );
}
