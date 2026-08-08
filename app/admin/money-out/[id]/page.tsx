"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import FormModal from "@/components/ui/FormModal";
import FormTextarea from "@/components/ui/FormTextarea";
import PermissionGuard from "@/components/auth/PermissionGuard";

import RecordExpenseModal from "@/components/moneyOut/RecordExpenseModal";

import usePermissions from "@/hooks/usePermissions";
import { logError } from "@/lib/logError";

import {
  getExpense,
  voidExpense,
  getExpenseReceiptUrl,
} from "@/services/expenses";
import { getExpenseCategories } from "@/services/expenseCategories";
import { getSuppliers } from "@/services/suppliers";
import { getClinicSettings } from "@/services/settings";

import { Expense, ExpenseCategory } from "@/types/expenses";
import { Supplier } from "@/types/procurement";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
        {label}
      </p>
      <p className="mt-1 text-graphite">{value || "—"}</p>
    </div>
  );
}

function ExpenseDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { hasPermission } = usePermissions();
  const canManage = hasPermission("money_out_manage");

  const [loading, setLoading] = useState(true);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [currency, setCurrency] = useState("KES");

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [expenseData, categoriesData, suppliersData, clinicSettings] =
        await Promise.all([
          getExpense(id),
          getExpenseCategories({ includeInactive: true }),
          getSuppliers({ includeInactive: true }),
          getClinicSettings(),
        ]);

      setExpense(expenseData);
      setCategories(categoriesData);
      setSuppliers(suppliersData);
      setCurrency(clinicSettings.currency || "KES");
    } catch (error) {
      logError("[ExpenseDetail] load failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to load expense."
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleViewReceipt() {
    if (!expense?.receipt_path) return;

    try {
      const url = await getExpenseReceiptUrl(expense.receipt_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      logError("[ExpenseDetail] handleViewReceipt failed:", error);

      toast.error("Failed to open receipt.");
    }
  }

  async function confirmVoid() {
    if (!expense) return;

    if (!voidReason.trim()) {
      toast.error("A reason is required to void this expense.");
      return;
    }

    try {
      setBusy(true);

      await voidExpense(expense.id, voidReason.trim());

      toast.success("Expense voided.");

      setVoidDialogOpen(false);
      setVoidReason("");

      await load();
    } catch (error) {
      logError("[ExpenseDetail] voidExpense failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to void expense."
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading expense..." />;
  }

  if (!expense) {
    return (
      <EmptyState
        title="Expense not found"
        description="This expense may have been removed."
      />
    );
  }

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);

  const voided = expense.status === "Voided";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            onClick={() => router.push("/admin/money-out")}
            className="mb-2 text-sm font-semibold text-eucalyptus hover:underline"
          >
            ← Back to Money Out
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{expense.description}</h1>
            <Badge color={voided ? "gray" : "green"}>{expense.status}</Badge>
          </div>
        </div>

        {canManage && !voided && (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setEditModalOpen(true)}>
              Edit
            </Button>
            <Button variant="danger" onClick={() => setVoidDialogOpen(true)}>
              Void
            </Button>
          </div>
        )}
      </div>

      {voided && (
        <Card className="border-clay/40 bg-clay/5">
          <p className="text-sm font-semibold text-clay">
            Voided{expense.voided_at ? ` on ${new Date(expense.voided_at).toLocaleDateString()}` : ""}
          </p>
          {expense.void_reason && (
            <p className="mt-1 text-sm text-graphite">
              Reason: {expense.void_reason}
            </p>
          )}
        </Card>
      )}

      <Card title="Expense Details">
        <div className="grid gap-5 sm:grid-cols-2">
          <DetailRow label="Amount" value={formatMoney(expense.amount)} />
          <DetailRow
            label="Category"
            value={expense.clinic_expense_categories?.name ?? "—"}
          />
          <DetailRow label="Date" value={expense.expense_date} />
          <DetailRow label="Payment Method" value={expense.payment_method} />
          <DetailRow label="Paid To" value={expense.payee ?? ""} />
          <DetailRow
            label="Supplier"
            value={expense.clinic_suppliers?.name ?? ""}
          />
          <DetailRow label="Reference" value={expense.reference ?? ""} />
          <DetailRow
            label="Created"
            value={new Date(expense.created_at).toLocaleString()}
          />
        </div>

        {expense.notes && (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-graphite">
              {expense.notes}
            </p>
          </div>
        )}

        {expense.receipt_path && (
          <div className="mt-5">
            <Button variant="secondary" onClick={handleViewReceipt}>
              View Receipt
            </Button>
          </div>
        )}
      </Card>

      <RecordExpenseModal
        open={editModalOpen}
        expense={expense}
        categories={categories}
        suppliers={suppliers}
        onClose={() => setEditModalOpen(false)}
        onSaved={load}
      />

      <FormModal
        open={voidDialogOpen}
        title="Void this expense?"
        loading={busy}
        submitText="Void Expense"
        onClose={() => {
          setVoidDialogOpen(false);
          setVoidReason("");
        }}
        onSubmit={confirmVoid}
      >
        <p className="text-sm text-slate-600">
          Voided expenses stop counting toward Money Out totals and can no
          longer be edited. This cannot be undone.
        </p>

        <FormTextarea
          label="Reason"
          required
          value={voidReason}
          onChange={setVoidReason}
        />
      </FormModal>
    </div>
  );
}

export default function ExpenseDetailPage() {
  return (
    <PermissionGuard permission="money_out">
      <ExpenseDetailContent />
    </PermissionGuard>
  );
}
