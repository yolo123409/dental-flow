"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getClinicSettings } from "@/services/settings";
import { getAccountLedger } from "@/services/ledger";
import { AccountLedger } from "@/types/ledger";
import { getSafeErrorMessage } from "@/lib/logError";

const DATE_RANGES = ["This Month", "Last Month", "This Year", "All Time"];

function AccountLedgerPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");

  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Year");
  const [ledger, setLedger] = useState<AccountLedger | null>(null);

  function resolveBounds(): { start: string | null; end: string | null } {
    const now = new Date();

    if (rangeLabel === "This Month") {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
        end: null,
      };
    }

    if (rangeLabel === "Last Month") {
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10),
        end: new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10),
      };
    }

    if (rangeLabel === "This Year") {
      return { start: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10), end: null };
    }

    return { start: null, end: null };
  }

  const load = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);

      const bounds = resolveBounds();

      const [clinicSettings, data] = await Promise.all([
        getClinicSettings(),
        getAccountLedger(id, bounds.start, bounds.end),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setLedger(data);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load account ledger."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rangeLabel]);

  useEffect(() => {
    load();
  }, [load]);

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(amount),
    [currency]
  );

  if (loading || !ledger) {
    return <LoadingSpinner text="Loading account ledger..." />;
  }

  const totalDebit = ledger.rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = ledger.rows.reduce((sum, row) => sum + row.credit, 0);

  return (
    <div className="space-y-8">
      <div>
        <button
          onClick={() => router.push("/admin/ledger")}
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </button>

        <h1 className="mt-2 font-display text-2xl font-bold">
          {ledger.account.code} {ledger.account.name}
        </h1>
        <p className="mt-1 text-sm text-mineral">{ledger.account.type} account</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DATE_RANGES.map((range) => (
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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-mineral">Opening Balance</p>
          <p className="mt-2 text-lg font-semibold">{formatMoney(ledger.openingBalance)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-mineral">Debits</p>
          <p className="mt-2 text-lg font-semibold">{formatMoney(totalDebit)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-mineral">Credits</p>
          <p className="mt-2 text-lg font-semibold">{formatMoney(totalCredit)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-mineral">Closing Balance</p>
          <p className="mt-2 text-lg font-semibold">{formatMoney(ledger.closingBalance)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-mineral">Transactions</p>
          <p className="mt-2 text-lg font-semibold">{ledger.rows.length}</p>
        </Card>
      </div>

      <Card title="Transactions">
        {ledger.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-mineral">
            No transactions posted to this account in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Date</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Description</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Debit</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Credit</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">Balance</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-200 bg-porcelain/60">
                  <td className="px-6 py-3 text-slate-600" colSpan={4}>
                    Opening Balance
                  </td>
                  <td className="px-6 py-3 text-right font-semibold">
                    {formatMoney(ledger.openingBalance)}
                  </td>
                  <td />
                </tr>
                {ledger.rows.map((row) => (
                  <tr key={row.transactionId} className="border-t border-slate-200">
                    <td className="px-6 py-4 text-slate-600">
                      {new Date(row.transactionDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">{row.description}</td>
                    <td className="px-6 py-4 text-right">
                      {row.debit > 0 ? formatMoney(row.debit) : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {row.credit > 0 ? formatMoney(row.credit) : "—"}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {formatMoney(row.runningBalance)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/admin/ledger/${row.transactionId}`}
                        className="text-sm font-medium text-eucalyptus hover:underline"
                      >
                        View
                      </Link>
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

export default function AccountLedgerPageWrapper() {
  return (
    <PermissionGuard permission="ledger">
      <AccountLedgerPage />
    </PermissionGuard>
  );
}
