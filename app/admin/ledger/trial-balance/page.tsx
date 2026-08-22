"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

import Card from "@/components/ui/Card";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getClinicSettings } from "@/services/settings";
import { getTrialBalance } from "@/services/ledger";
import { TrialBalance } from "@/types/ledger";
import { getSafeErrorMessage } from "@/lib/logError";

function TrialBalancePageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const [clinicSettings, data] = await Promise.all([
          getClinicSettings(),
          getTrialBalance(),
        ]);

        setCurrency(clinicSettings.currency || "KES");
        setTrialBalance(data);
      } catch (error) {
        toast.error(getSafeErrorMessage(error, "Failed to load trial balance."));
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
        maximumFractionDigits: 2,
      }).format(amount),
    [currency]
  );

  if (loading || !trialBalance) {
    return <LoadingSpinner text="Loading trial balance..." />;
  }

  const rowsWithBalance = trialBalance.rows.filter(
    (row) => row.debitBalance > 0 || row.creditBalance > 0
  );

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Trial Balance</h1>
        <p className="mt-2 text-slate-500">
          Every account&apos;s net debit or credit balance, as of now. Total debits must always
          equal total credits.
        </p>
      </div>

      <div
        className={`flex items-center gap-3 rounded-lg px-6 py-4 text-sm font-semibold ${
          trialBalance.balanced ? "status-completed" : "status-cancelled"
        }`}
      >
        {trialBalance.balanced ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
        {trialBalance.balanced ? "BALANCED" : "CRITICAL ERROR — NOT BALANCED"}
      </div>

      <Card>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Account</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Type</th>
                <th className="px-6 py-4 text-right text-sm font-semibold">Debit Balance</th>
                <th className="px-6 py-4 text-right text-sm font-semibold">Credit Balance</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithBalance.map((row) => (
                <tr key={row.accountId} className="border-t border-slate-200">
                  <td className="px-6 py-4 font-medium">
                    <Link
                      href={`/admin/ledger/accounts/${row.accountId}`}
                      className="text-eucalyptus hover:underline"
                    >
                      {row.accountCode} {row.accountName}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{row.accountType}</td>
                  <td className="px-6 py-4 text-right">
                    {row.debitBalance > 0 ? formatMoney(row.debitBalance) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {row.creditBalance > 0 ? formatMoney(row.creditBalance) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr>
                <td className="px-6 py-4" colSpan={2}>
                  Total
                </td>
                <td className="px-6 py-4 text-right">{formatMoney(trialBalance.totalDebits)}</td>
                <td className="px-6 py-4 text-right">{formatMoney(trialBalance.totalCredits)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function TrialBalancePage() {
  return (
    <PermissionGuard permission="ledger">
      <TrialBalancePageContent />
    </PermissionGuard>
  );
}
