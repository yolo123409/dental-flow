"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionGuard from "@/components/auth/PermissionGuard";

import usePermissions from "@/hooks/usePermissions";
import { getClinicSettings } from "@/services/settings";
import { getLedgerTransaction, reverseLedgerTransaction } from "@/services/ledger";
import { LedgerTransaction } from "@/types/ledger";
import { getSafeErrorMessage } from "@/lib/logError";

const REFERENCE_ROUTES: Record<string, (id: string) => string> = {
  invoice: (id) => `/admin/billing/${id}`,
  grn: (id) => `/admin/inventory/grns/${id}`,
  inventory_movement: () => `/admin/inventory`,
};

function TransactionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");

  const { hasPermission } = usePermissions();
  const canManage = hasPermission("ledger_manage");

  const [loading, setLoading] = useState(true);
  const [transaction, setTransaction] = useState<LedgerTransaction | null>(null);
  const [currency, setCurrency] = useState("KES");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reversing, setReversing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);

      const [clinicSettings, data] = await Promise.all([
        getClinicSettings(),
        getLedgerTransaction(id),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setTransaction(data);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load transaction."));
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  async function handleReverse() {
    if (!transaction) return;

    try {
      setReversing(true);

      await reverseLedgerTransaction(transaction.id);

      toast.success("Transaction reversed.");

      setConfirmOpen(false);

      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to reverse transaction."));
    } finally {
      setReversing(false);
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading transaction..." />;
  }

  if (!transaction) {
    return (
      <Card>
        <p className="text-slate-500">Transaction not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push("/admin/ledger")}>
          Back to Ledger
        </Button>
      </Card>
    );
  }

  const entries = transaction.clinic_ledger_entries ?? [];
  const totalDebit = entries.reduce((sum, entry) => sum + Number(entry.debit), 0);
  const totalCredit = entries.reduce((sum, entry) => sum + Number(entry.credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const sourceLink =
    transaction.reference_type && transaction.reference_id
      ? REFERENCE_ROUTES[transaction.reference_type]?.(transaction.reference_id)
      : null;

  const canReverse =
    canManage && !transaction.reversed_by && transaction.transaction_type !== "Reversal";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <button
          onClick={() => router.push("/admin/ledger")}
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </button>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">{transaction.description}</h1>
            <p className="mt-1 text-sm text-mineral">
              {transaction.transaction_type} · {new Date(transaction.transaction_date).toLocaleDateString()}
            </p>
          </div>

          {canReverse && (
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              Reverse Transaction
            </Button>
          )}
        </div>
      </div>

      {transaction.reversed_by && (
        <div className="status-scheduled rounded-lg px-6 py-4 text-sm">
          This transaction has been reversed.{" "}
          <Link
            href={`/admin/ledger/${transaction.reversed_by}`}
            className="font-semibold underline"
          >
            View the reversal
          </Link>
        </div>
      )}

      {transaction.reverses_transaction_id && (
        <div className="bg-porcelain rounded-lg px-6 py-4 text-sm text-mineral">
          This is a reversal of{" "}
          <Link
            href={`/admin/ledger/${transaction.reverses_transaction_id}`}
            className="font-semibold text-eucalyptus underline"
          >
            another transaction
          </Link>
          .
        </div>
      )}

      <Card title="Details">
        <dl className="grid gap-6 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Transaction ID</dt>
            <dd className="mt-1 font-mono text-sm">{transaction.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Date</dt>
            <dd className="mt-1">{new Date(transaction.transaction_date).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Reference</dt>
            <dd className="mt-1">
              {transaction.reference_type ? (
                sourceLink ? (
                  <Link href={sourceLink} className="text-eucalyptus hover:underline">
                    {transaction.reference_type}
                  </Link>
                ) : (
                  transaction.reference_type
                )
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Created By</dt>
            <dd className="mt-1">{transaction.clinic_users?.full_name ?? "System (automatic)"}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Created At</dt>
            <dd className="mt-1">{new Date(transaction.created_at).toLocaleString()}</dd>
          </div>
          {transaction.patients && (
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Patient</dt>
              <dd className="mt-1">
                {transaction.patients.first_name} {transaction.patients.last_name}
              </dd>
            </div>
          )}
          {transaction.clinic_suppliers && (
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">Supplier</dt>
              <dd className="mt-1">{transaction.clinic_suppliers.name}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title="Entries">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Account</th>
                <th className="px-6 py-4 text-right text-sm font-semibold">Debit</th>
                <th className="px-6 py-4 text-right text-sm font-semibold">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-200">
                  <td className="px-6 py-4">
                    {entry.clinic_ledger_accounts
                      ? `${entry.clinic_ledger_accounts.code} ${entry.clinic_ledger_accounts.name}`
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {Number(entry.debit) > 0 ? formatMoney(Number(entry.debit)) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {Number(entry.credit) > 0 ? formatMoney(Number(entry.credit)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr>
                <td className="px-6 py-4">Total</td>
                <td className="px-6 py-4 text-right">{formatMoney(totalDebit)}</td>
                <td className="px-6 py-4 text-right">{formatMoney(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div
          className={`mt-4 flex items-center gap-2 text-sm font-semibold ${
            balanced ? "text-eucalyptus" : "text-clay"
          }`}
        >
          <CheckCircle2 size={16} />
          {balanced ? "Balanced" : "Not Balanced"}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Reverse this transaction"
        description="This creates a new, offsetting transaction with every debit and credit flipped. The original transaction is preserved unchanged for the audit trail."
        confirmText="Reverse Transaction"
        loading={reversing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleReverse}
      />
    </div>
  );
}

export default function TransactionDetailPageWrapper() {
  return (
    <PermissionGuard permission="ledger">
      <TransactionDetailPage />
    </PermissionGuard>
  );
}
