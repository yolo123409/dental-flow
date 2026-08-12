"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  DollarSign,
  AlertCircle,
  Users,
  CalendarDays,
  Wallet,
  TrendingUp,
  Target,
  Boxes,
  Stethoscope,
} from "lucide-react";

import PageContainer from "@/components/ui/PageContainer";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

import DateRangeTabs from "@/components/organization/DateRangeTabs";
import OrganizationRevenueTrendChart from "@/components/organization/OrganizationRevenueTrendChart";
import BranchPerformanceTable from "@/components/organization/BranchPerformanceTable";
import AddBranchModal from "@/components/organization/AddBranchModal";
import InviteOrganizationMemberModal from "@/components/organization/InviteOrganizationMemberModal";
import OrganizationPatientAnalytics from "@/components/organization/OrganizationPatientAnalytics";
import OrganizationAppointmentAnalytics from "@/components/organization/OrganizationAppointmentAnalytics";
import OrganizationProcurementWidget from "@/components/organization/OrganizationProcurementWidget";
import OrganizationInventoryWidget from "@/components/organization/OrganizationInventoryWidget";
import OrganizationRecentActivity from "@/components/organization/OrganizationRecentActivity";
import OrganizationSearch from "@/components/organization/OrganizationSearch";

import { useAuth } from "@/contexts/AuthContext";
import { roundMoney } from "@/lib/currency";

import {
  getMyOrganization,
  switchActiveBranch,
} from "@/services/organizations";

import {
  getOrganizationBranchPerformance,
  getOrganizationRevenueTrend,
  getOrganizationExpenseBreakdown,
  getOrganizationExpenseTrend,
  getOrganizationAppointmentBreakdown,
  getOrganizationLowStockItems,
  getOrganizationHighestValueInventory,
  getOrganizationRecentGrnReceipts,
  getOrganizationRecentPurchaseOrders,
  getOrganizationSupplierSpend,
  getOrganizationRecentActivity,
  OrganizationBranchPerformance,
  OrganizationRevenueTrendPoint,
  OrganizationExpenseTrendPoint,
  OrganizationExpenseBreakdown,
  OrganizationAppointmentBreakdown,
  OrganizationLowStockItem,
  OrganizationHighestValueItem,
  OrganizationGrnReceipt,
  OrganizationRecentPurchaseOrder,
  OrganizationSupplierSpend,
  OrganizationActivityItem,
} from "@/services/organizationAnalytics";

import { Organization } from "@/types/organization";
import { InvitableOrganizationRole } from "@/types/organizationInvitation";

// Branches within one organization are expected to share a currency in
// practice - full multi-currency aggregation across branches is out of
// scope for this dashboard, so a fixed default is used rather than
// fetching each branch's own clinic_settings.currency.
const DEFAULT_CURRENCY = "KES";

export default function OrganizationOverviewPage() {
  const { organizationUser } = useAuth();

  const [organization, setOrganization] =
    useState<Organization | null>(null);

  const [branches, setBranches] = useState<
    OrganizationBranchPerformance[]
  >([]);

  const [revenueTrend, setRevenueTrend] = useState<
    OrganizationRevenueTrendPoint[]
  >([]);

  const [expenseBreakdown, setExpenseBreakdown] = useState<
    OrganizationExpenseBreakdown[]
  >([]);

  const [expenseTrend, setExpenseTrend] = useState<
    OrganizationExpenseTrendPoint[]
  >([]);

  const [appointmentBreakdown, setAppointmentBreakdown] = useState<
    OrganizationAppointmentBreakdown[]
  >([]);

  const [lowStock, setLowStock] = useState<OrganizationLowStockItem[]>([]);

  const [highestValue, setHighestValue] = useState<
    OrganizationHighestValueItem[]
  >([]);

  const [recentGrnReceipts, setRecentGrnReceipts] = useState<
    OrganizationGrnReceipt[]
  >([]);

  const [recentPurchaseOrders, setRecentPurchaseOrders] = useState<
    OrganizationRecentPurchaseOrder[]
  >([]);

  const [topSuppliers, setTopSuppliers] = useState<
    OrganizationSupplierSpend[]
  >([]);

  const [recentActivity, setRecentActivity] = useState<
    OrganizationActivityItem[]
  >([]);

  const [range, setRange] = useState("This Month");

  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [expenseBreakdownLoading, setExpenseBreakdownLoading] =
    useState(true);
  const [expenseTrendLoading, setExpenseTrendLoading] = useState(true);
  const [appointmentBreakdownLoading, setAppointmentBreakdownLoading] =
    useState(true);
  const [appointmentBreakdownError, setAppointmentBreakdownError] =
    useState<string | null>(null);
  const [procurementInventoryLoading, setProcurementInventoryLoading] =
    useState(true);
  const [recentActivityLoading, setRecentActivityLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] =
    useState<InvitableOrganizationRole>("Manager");

  const load = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const [org, performance] = await Promise.all([
        getMyOrganization(organizationUser.organization_id),
        getOrganizationBranchPerformance(
          organizationUser.organization_id,
          range
        ),
      ]);

      setOrganization(org);
      setBranches(performance);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load your organization."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationUser, range]);

  const loadTrend = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setTrendLoading(true);
      setTrendError(null);

      const trend = await getOrganizationRevenueTrend(
        organizationUser.organization_id,
        range
      );

      setRevenueTrend(trend);
    } catch (error) {
      console.error(error);

      setTrendError(
        error instanceof Error
          ? error.message
          : "Failed to load revenue trend."
      );
    } finally {
      setTrendLoading(false);
    }
  }, [organizationUser, range]);

  const loadExpenseBreakdown = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setExpenseBreakdownLoading(true);

      const breakdown = await getOrganizationExpenseBreakdown(
        organizationUser.organization_id,
        range
      );

      setExpenseBreakdown(breakdown);
    } catch (error) {
      // Isolated in its own try/catch, matching loadTrend above - a
      // Money Out breakdown failure shouldn't take down the rest of the
      // dashboard.
      console.error(error);
    } finally {
      setExpenseBreakdownLoading(false);
    }
  }, [organizationUser, range]);

  const loadExpenseTrend = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setExpenseTrendLoading(true);

      const trend = await getOrganizationExpenseTrend(
        organizationUser.organization_id,
        range
      );

      setExpenseTrend(trend);
    } catch (error) {
      // Isolated, matching loadTrend/loadExpenseBreakdown - the Financial
      // Trend chart just falls back to a revenue-only line if this fails.
      console.error(error);
    } finally {
      setExpenseTrendLoading(false);
    }
  }, [organizationUser, range]);

  const loadAppointmentBreakdown = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setAppointmentBreakdownLoading(true);
      setAppointmentBreakdownError(null);

      const breakdown = await getOrganizationAppointmentBreakdown(
        organizationUser.organization_id,
        range
      );

      setAppointmentBreakdown(breakdown);
    } catch (error) {
      console.error(error);

      setAppointmentBreakdownError(
        error instanceof Error
          ? error.message
          : "Failed to load appointment analytics."
      );
    } finally {
      setAppointmentBreakdownLoading(false);
    }
  }, [organizationUser, range]);

  // Bundled into one Promise.all - all five are secondary "detail" widgets
  // (Procurement + Inventory sections) that load together, one isolated
  // try/catch instead of five separate ones for the same failure mode.
  const loadProcurementInventory = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setProcurementInventoryLoading(true);

      const [low, highest, receipts, orders, suppliers] = await Promise.all([
        getOrganizationLowStockItems(organizationUser.organization_id),
        getOrganizationHighestValueInventory(
          organizationUser.organization_id
        ),
        getOrganizationRecentGrnReceipts(organizationUser.organization_id),
        getOrganizationRecentPurchaseOrders(
          organizationUser.organization_id
        ),
        getOrganizationSupplierSpend(
          organizationUser.organization_id,
          range
        ),
      ]);

      setLowStock(low);
      setHighestValue(highest);
      setRecentGrnReceipts(receipts);
      setRecentPurchaseOrders(orders);
      setTopSuppliers(suppliers);
    } catch (error) {
      console.error(error);
    } finally {
      setProcurementInventoryLoading(false);
    }
  }, [organizationUser, range]);

  const loadRecentActivity = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setRecentActivityLoading(true);

      const activity = await getOrganizationRecentActivity(
        organizationUser.organization_id
      );

      setRecentActivity(activity);
    } catch (error) {
      console.error(error);
    } finally {
      setRecentActivityLoading(false);
    }
  }, [organizationUser]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTrend();
  }, [loadTrend]);

  useEffect(() => {
    loadExpenseBreakdown();
  }, [loadExpenseBreakdown]);

  useEffect(() => {
    loadExpenseTrend();
  }, [loadExpenseTrend]);

  useEffect(() => {
    loadAppointmentBreakdown();
  }, [loadAppointmentBreakdown]);

  useEffect(() => {
    loadProcurementInventory();
  }, [loadProcurementInventory]);

  useEffect(() => {
    loadRecentActivity();
  }, [loadRecentActivity]);

  function openInvite(role: InvitableOrganizationRole) {
    setInviteRole(role);
    setInviteOpen(true);
  }

  async function handleSwitch(clinicId: string) {
    try {
      setSwitchingId(clinicId);

      await switchActiveBranch(clinicId);

      // Every /admin page fetches its own clinic-scoped data once on
      // mount - only a full reload guarantees none of it is stale.
      window.location.href = "/admin";
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to switch into this branch."
      );

      setSwitchingId(null);
    }
  }

  if (!organizationUser) {
    return null;
  }

  if (loading) {
    return (
      <PageContainer>
        <LoadingSpinner text="Loading organization..." />
      </PageContainer>
    );
  }

  const totals = branches.reduce(
    (acc, branch) => ({
      revenue: acc.revenue + branch.revenue,
      moneyOut: acc.moneyOut + branch.money_out,
      outstanding: acc.outstanding + branch.outstanding_balance,
      patients: acc.patients + branch.patient_count,
      appointments: acc.appointments + branch.appointment_count,
      inventoryValue: acc.inventoryValue + branch.inventory_value,
      dentists: acc.dentists + branch.dentist_count,
    }),
    {
      revenue: 0,
      moneyOut: 0,
      outstanding: 0,
      patients: 0,
      appointments: 0,
      inventoryValue: 0,
      dentists: 0,
    }
  );

  // NULL-safe org-wide break-even: only branches with a configured target
  // contribute to the sum, and if none are configured the combined target
  // stays null (never 0) so "Above Target" is never falsely shown for an
  // org that simply hasn't set any targets yet - same rule as the
  // single-branch Financial Targets feature.
  const configuredTargets = branches.filter(
    (branch) => branch.break_even_target != null
  );

  const breakEvenTarget =
    configuredTargets.length > 0
      ? configuredTargets.reduce(
          (sum, branch) => sum + (branch.break_even_target ?? 0),
          0
        )
      : null;

  const netPosition = roundMoney(totals.revenue - totals.moneyOut);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 0,
    }).format(value);

  // Same below/reached/above classification RevenueWidget already uses
  // for the single-branch break-even card - reused, not re-derived.
  const breakEvenStatus = (() => {
    if (breakEvenTarget == null) return null;

    const diff = roundMoney(totals.revenue - breakEvenTarget);

    if (diff < 0) {
      return { label: `${formatCurrency(Math.abs(diff))} below target`, kind: "below" as const };
    }

    if (diff === 0) {
      return { label: "At target", kind: "reached" as const };
    }

    return { label: `${formatCurrency(diff)} above target`, kind: "above" as const };
  })();

  const largestExpenseCategory = expenseBreakdown[0] ?? null;

  const highestSpendingBranch = branches.reduce<
    OrganizationBranchPerformance | null
  >((highest, branch) => {
    if (branch.money_out <= 0) return highest;
    if (!highest || branch.money_out > highest.money_out) return branch;
    return highest;
  }, null);

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">
            {organization?.name ?? "Organization"} Overview
          </h1>

          <p className="mt-2 text-mineral">
            {branches.length}{" "}
            {branches.length === 1 ? "branch" : "branches"}
          </p>
        </div>

        <OrganizationSearch />
      </div>

      {organizationUser.role === "CEO" && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setAddBranchOpen(true)}>
            + Add Branch
          </Button>

          <Button
            variant="secondary"
            onClick={() => openInvite("Manager")}
          >
            Invite Manager
          </Button>

          <Button
            variant="secondary"
            onClick={() => openInvite("Partner")}
          >
            Invite Partner
          </Button>

          <a
            href="#financial-trend"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sea-glass bg-enamel px-4 py-2.5 text-sm font-semibold text-graphite transition-colors hover:bg-porcelain"
          >
            View Reports
          </a>

          <Link
            href="/admin/organization/settings"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sea-glass bg-enamel px-4 py-2.5 text-sm font-semibold text-graphite transition-colors hover:bg-porcelain"
          >
            Branch Settings
          </Link>
        </div>
      )}

      {branches.length === 0 ? (
        <Card title="Branches">
          <div className="space-y-4 py-8 text-center">
            <p className="text-sm text-mineral">
              {organizationUser.role === "CEO"
                ? "You haven't created a branch yet."
                : "Your organization has no branches yet."}
            </p>

            {organizationUser.role === "CEO" && (
              <Button onClick={() => setAddBranchOpen(true)}>
                Create Your First Branch
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          <DateRangeTabs value={range} onChange={setRange} />

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Revenue"
              value={formatCurrency(totals.revenue)}
              icon={<DollarSign size={20} />}
            />

            <StatCard
              title="Money Out"
              value={formatCurrency(totals.moneyOut)}
              icon={<Wallet size={20} />}
            />

            <StatCard
              title="Net Operating Position"
              value={formatCurrency(netPosition)}
              subtitle={
                netPosition < 0
                  ? "Operating deficit"
                  : "Above recorded expenses"
              }
              icon={<TrendingUp size={20} />}
            />

            <StatCard
              title="Break-even Status"
              value={
                breakEvenStatus ? breakEvenStatus.label : "Not configured"
              }
              subtitle={
                breakEvenTarget != null
                  ? `Target: ${formatCurrency(breakEvenTarget)}`
                  : undefined
              }
              icon={<Target size={20} />}
            />

            <StatCard
              title="Patients"
              value={totals.patients}
              icon={<Users size={20} />}
            />

            <StatCard
              title="Appointments"
              value={totals.appointments}
              icon={<CalendarDays size={20} />}
            />

            <StatCard
              title="Inventory Value"
              value={formatCurrency(totals.inventoryValue)}
              icon={<Boxes size={20} />}
            />

            <StatCard
              title="Outstanding"
              value={formatCurrency(totals.outstanding)}
              icon={<AlertCircle size={20} />}
            />

            <StatCard
              title="Active Dentists"
              value={totals.dentists}
              icon={<Stethoscope size={20} />}
            />
          </div>

          <Card title="Money Out">
            {expenseBreakdownLoading ? (
              <p className="text-sm text-mineral">Loading...</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
                    Largest Expense Category
                  </p>
                  <p className="mt-1 text-lg font-semibold text-graphite">
                    {largestExpenseCategory
                      ? largestExpenseCategory.category_name
                      : "—"}
                  </p>
                  {largestExpenseCategory && (
                    <p className="text-sm text-mineral">
                      {formatCurrency(largestExpenseCategory.total)}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
                    Highest Spending Branch
                  </p>
                  <p className="mt-1 text-lg font-semibold text-graphite">
                    {highestSpendingBranch
                      ? highestSpendingBranch.clinic_name
                      : "—"}
                  </p>
                  {highestSpendingBranch && (
                    <p className="text-sm text-mineral">
                      {formatCurrency(highestSpendingBranch.money_out)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!expenseBreakdownLoading && expenseBreakdown.length > 0 && (
              <div className="mt-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
                  Top Expense Categories
                </p>

                <div className="space-y-2">
                  {expenseBreakdown.slice(0, 5).map((category) => (
                    <div
                      key={category.category_name}
                      className="flex items-center justify-between rounded-lg border border-sea-glass px-3 py-2 text-sm"
                    >
                      <span className="text-graphite">
                        {category.category_name}
                      </span>
                      <span className="font-semibold text-graphite">
                        {formatCurrency(category.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <div id="financial-trend" className="scroll-mt-8">
            <OrganizationRevenueTrendChart
              data={revenueTrend}
              expenseData={expenseTrend}
              range={range}
              currency={DEFAULT_CURRENCY}
              loading={trendLoading || expenseTrendLoading}
              error={trendError}
            />
          </div>

          <OrganizationPatientAnalytics branches={branches} loading={loading} />

          <OrganizationAppointmentAnalytics
            breakdown={appointmentBreakdown}
            loading={appointmentBreakdownLoading}
            error={appointmentBreakdownError}
          />

          <OrganizationProcurementWidget
            recentPurchaseOrders={recentPurchaseOrders}
            topSuppliers={topSuppliers}
            recentDeliveries={recentGrnReceipts}
            currency={DEFAULT_CURRENCY}
            loading={procurementInventoryLoading}
          />

          <OrganizationInventoryWidget
            lowStock={lowStock}
            highestValue={highestValue}
            recentlyReceived={recentGrnReceipts}
            currency={DEFAULT_CURRENCY}
            loading={procurementInventoryLoading}
          />

          <BranchPerformanceTable
            branches={branches}
            currency={DEFAULT_CURRENCY}
            canSwitch={organizationUser.role !== "Viewer"}
            switchingId={switchingId}
            onSwitch={handleSwitch}
          />

          <OrganizationRecentActivity
            items={recentActivity}
            loading={recentActivityLoading}
          />
        </>
      )}

      {organizationUser.role === "CEO" && (
        <p className="text-sm text-mineral">
          Manage invitations and access from{" "}
          <Link
            href="/admin/organization/team"
            className="font-semibold text-eucalyptus hover:underline"
          >
            Team &amp; Access
          </Link>
          , or update your organization's details in{" "}
          <Link
            href="/admin/organization/settings"
            className="font-semibold text-eucalyptus hover:underline"
          >
            Organization Settings
          </Link>
          .
        </p>
      )}

      {organizationUser.role === "CEO" && (
        <AddBranchModal
          open={addBranchOpen}
          organizationUser={organizationUser}
          onClose={() => setAddBranchOpen(false)}
          onSuccess={load}
        />
      )}

      {organizationUser.role === "CEO" && (
        <InviteOrganizationMemberModal
          open={inviteOpen}
          organizationId={organizationUser.organization_id}
          organizationName={organization?.name ?? ""}
          initialRole={inviteRole}
          onClose={() => setInviteOpen(false)}
          onSuccess={load}
        />
      )}
    </PageContainer>
  );
}
