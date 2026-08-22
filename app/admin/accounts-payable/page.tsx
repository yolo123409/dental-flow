"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HandCoins, Receipt, Wallet } from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import SearchInput from "@/components/ui/SearchInput";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getClinicSettings } from "@/services/settings";
import { getSupplierApSummaries } from "@/services/supplierPayments";
import { SupplierApSummary } from "@/types/supplierPayments";
import { getSafeErrorMessage } from "@/lib/logError";

const STATUSES: (SupplierApSummary["status"] | "All")[] = [
  "All",
  "Outstanding",
  "Partially Paid",
  "Paid",
];

function AccountsPayableContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [summaries, setSummaries] = useState<SupplierApSummary[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("All");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const [clinicSettings, data] = await Promise.all([
          getClinicSettings(),
          getSupplierApSummaries(),
        ]);

        setCurrency(clinicSettings.currency || "KES");
        setSummaries(data);
      } catch (error) {
        toast.error(
          getSafeErrorMessage(error, "Failed to load accounts payable.")
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount),
    [currency]
  );

  const filtered = summaries.filter((row) => {
    const matchesSearch = row.supplierName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || row.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totals = summaries.reduce(
    (acc, row) => ({
      purchases: acc.purchases + row.totalPurchases,
      paid: acc.paid + row.totalPaid,
      outstanding: acc.outstanding + row.outstanding,
    }),
    { purchases: 0, paid: 0, outstanding: 0 }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Accounts Payable</h1>
        <p className="mt-2 text-slate-500">
          What your clinic owes suppliers, based on received goods (GRNs) minus recorded
          payments.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          title="Total Purchases"
          value={formatMoney(totals.purchases)}
          icon={<Receipt size={20} />}
        />
        <StatCard
          title="Total Paid"
          value={formatMoney(totals.paid)}
          icon={<Wallet size={20} />}
        />
        <StatCard
          title="Total Outstanding"
          value={formatMoney(totals.outstanding)}
          icon={<HandCoins size={20} />}
        />
      </div>

      <Card>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-sm flex-1">
            <SearchInput value={search} onChange={setSearch} placeholder="Search suppliers..." />
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  statusFilter === status
                    ? "bg-eucalyptus text-white"
                    : "border border-sea-glass bg-enamel hover:bg-porcelain"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner text="Loading accounts payable..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No supplier liabilities found"
            description="Outstanding balances appear here once a GRN has been received from a supplier."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Supplier</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Total Purchases</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Total Paid</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Outstanding</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Last Payment</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.supplierId} className="border-t border-slate-200">
                    <td className="px-6 py-4 font-medium">
                      <Link
                        href={`/admin/inventory/suppliers/${row.supplierId}`}
                        className="text-eucalyptus hover:underline"
                      >
                        {row.supplierName}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-right">{formatMoney(row.totalPurchases)}</td>
                    <td className="px-6 py-4 text-right">{formatMoney(row.totalPaid)}</td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {formatMoney(row.outstanding)}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {row.lastPaymentDate
                        ? new Date(row.lastPaymentDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        color={
                          row.status === "Paid"
                            ? "green"
                            : row.status === "Partially Paid"
                            ? "yellow"
                            : "red"
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function AccountsPayablePage() {
  return (
    <PermissionGuard permission="accounts_payable">
      <AccountsPayableContent />
    </PermissionGuard>
  );
}
