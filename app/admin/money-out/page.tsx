"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import SearchInput from "@/components/ui/SearchInput";
import PermissionGuard from "@/components/auth/PermissionGuard";

import RecordExpenseModal from "@/components/moneyOut/RecordExpenseModal";

import usePermissions from "@/hooks/usePermissions";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import {
  getExpenses,
  getExpenseSummary,
  getMonthOverMonthExpenses,
  MonthOverMonthExpenses,
} from "@/services/expenses";
import { getExpenseCategories } from "@/services/expenseCategories";
import { getSuppliers } from "@/services/suppliers";
import { getClinicSettings } from "@/services/settings";

import { Expense, ExpenseCategory, ExpenseSummary } from "@/types/expenses";
import { Supplier } from "@/types/procurement";

const DATE_RANGES = ["Today", "7 Days", "30 Days", "This Month", "This Year"];

function MoneyOutPageContent() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("money_out_manage");

  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [momo, setMomo] = useState<MonthOverMonthExpenses | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [currency, setCurrency] = useState("KES");

  const [dateRange, setDateRange] = useState("This Month");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const filters = {
        dateRange,
        categoryId: categoryFilter || undefined,
        paymentMethod: methodFilter || undefined,
        search: search || undefined,
      };

      const [expensesData, summaryData, momoData, categoriesData, suppliersData, clinicSettings] =
        await Promise.all([
          getExpenses(filters),
          getExpenseSummary(dateRange),
          getMonthOverMonthExpenses(),
          getExpenseCategories(),
          getSuppliers(),
          getClinicSettings(),
        ]);

      setExpenses(expensesData);
      setSummary(summaryData);
      setMomo(momoData);
      setCategories(categoriesData);
      setSuppliers(suppliersData);
      setCurrency(clinicSettings.currency || "KES");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load Money Out.", "[MoneyOutPage] load failed:")
      );
    } finally {
      setLoading(false);
    }
  }, [dateRange, categoryFilter, methodFilter, search]);

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

  // Voided expenses stay visible in the list (financial history is never
  // hidden) but never count toward totals, so this is filtered
  // independently of the raw `expenses` list used for the table below.
  const visibleExpenses = expenses;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Money Out</h1>
          <p className="mt-2 text-slate-500">
            Track what leaves the clinic and where it goes.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => { setEditingExpense(null); setModalOpen(true); }}>
            + Record Money Out
          </Button>
        )}
      </div>

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

      {loading ? (
        <LoadingSpinner text="Loading Money Out..." />
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={`Money Out — ${dateRange}`}
              value={formatMoney(summary?.total ?? 0)}
              subtitle={
                momo
                  ? momo.diffPercent == null
                    ? undefined
                    : `${momo.diffPercent >= 0 ? "+" : ""}${momo.diffPercent}% vs last month`
                  : undefined
              }
            />

            <StatCard
              title="Largest Category"
              value={summary?.largestCategory?.categoryName ?? "—"}
              subtitle={
                summary?.largestCategory
                  ? formatMoney(summary.largestCategory.total)
                  : undefined
              }
            />

            <StatCard
              title="Transactions"
              value={summary?.transactionCount ?? 0}
            />

            <StatCard
              title="Average Expense"
              value={formatMoney(summary?.averageExpense ?? 0)}
            />
          </div>

          {summary && summary.breakdown.length > 0 && (
            <Card title="Where the Money Went">
              <div className="space-y-4">
                {summary.breakdown.map((entry) => (
                  <div key={entry.categoryId}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-graphite">
                        {entry.categoryName}
                      </span>
                      <span className="text-mineral">
                        {formatMoney(entry.total)} · {entry.percentage}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-porcelain">
                      <div
                        className="h-full rounded-full bg-eucalyptus"
                        style={{ width: `${entry.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-sm flex-1">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search description, payee, or reference..."
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                >
                  <option value="">All Categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <select
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                >
                  <option value="">All Methods</option>
                  <option value="Cash">Cash</option>
                  <option value="M-Pesa">M-Pesa</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Card">Card</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            {visibleExpenses.length === 0 ? (
              <EmptyState
                title="No money-out transactions recorded yet."
                description="Record your first expense to start tracking where money goes."
                action={
                  canManage ? (
                    <Button onClick={() => { setEditingExpense(null); setModalOpen(true); }}>
                      + Record Money Out
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Date</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Description</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Category</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Paid To</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Method</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Amount</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleExpenses.map((expense) => (
                      <tr key={expense.id} className="border-t border-slate-200">
                        <td className="px-6 py-5 text-slate-600">
                          {expense.expense_date}
                        </td>
                        <td className="px-6 py-5 font-medium">
                          <Link
                            href={`/admin/money-out/${expense.id}`}
                            className="text-eucalyptus hover:underline"
                          >
                            {expense.description}
                          </Link>
                        </td>
                        <td className="px-6 py-5 text-slate-600">
                          {expense.clinic_expense_categories?.name ?? "—"}
                        </td>
                        <td className="px-6 py-5 text-slate-600">
                          {expense.payee || expense.clinic_suppliers?.name || "—"}
                        </td>
                        <td className="px-6 py-5 text-slate-600">
                          {expense.payment_method}
                        </td>
                        <td className="px-6 py-5 text-right font-semibold">
                          {formatMoney(expense.amount)}
                        </td>
                        <td className="px-6 py-5">
                          <Badge color={expense.status === "Voided" ? "gray" : "green"}>
                            {expense.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <RecordExpenseModal
        open={modalOpen}
        expense={editingExpense}
        categories={categories}
        suppliers={suppliers}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

export default function MoneyOutPage() {
  return (
    <PermissionGuard permission="money_out">
      <MoneyOutPageContent />
    </PermissionGuard>
  );
}
