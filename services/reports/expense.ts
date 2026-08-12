import { getExpenses } from "@/services/expenses";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, isoDate, periodLabel } from "./shared";

/**
 * Reuses the Money Out system directly (getExpenses) rather than a
 * second expense query - categories come from the clinic's own
 * clinic_expense_categories, never hard-coded, and Voided expenses are
 * excluded from totals the same way Money Out's own getExpenseSummary
 * already excludes them.
 */
export async function generateExpenseReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  const expenses = await getExpenses({
    dateRange: period.start && period.end ? "Custom" : undefined,
    customStart: period.start ? isoDate(period.start) : undefined,
    customEnd: period.end ? isoDate(period.end) : undefined,
    categoryId: filters.categoryId,
    paymentMethod: filters.paymentMethod,
  });

  const paid = expenses.filter((expense) => expense.status === "Paid");

  const total = paid.reduce((sum, expense) => sum + Number(expense.amount), 0);

  const byCategory = new Map<string, number>();
  for (const expense of paid) {
    const name = expense.clinic_expense_categories?.name ?? "Uncategorized";
    byCategory.set(name, (byCategory.get(name) ?? 0) + Number(expense.amount));
  }

  const categoryRows = Array.from(byCategory.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
    }));

  const byDay = new Map<string, number>();
  for (const expense of paid) {
    byDay.set(
      expense.expense_date,
      (byDay.get(expense.expense_date) ?? 0) + Number(expense.amount)
    );
  }

  return {
    id: "expense",
    title: "Expense Report",
    category: "Financial",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      {
        label: "Total Expenses",
        value: currencyValue(total, clinicMeta.currency),
      },
      { label: "Transactions", value: String(paid.length) },
      {
        label: "Top Category",
        value: categoryRows[0]?.category ?? "—",
        subtitle: categoryRows[0]
          ? currencyValue(categoryRows[0].amount, clinicMeta.currency)
          : undefined,
      },
    ],

    columns: [
      { key: "category", label: "Category", format: "text" },
      { key: "amount", label: "Amount", format: "currency" },
      { key: "percentage", label: "% of Total", format: "percent" },
    ],
    rows: categoryRows,
    totalsRow: { category: "Total", amount: total, percentage: 100 },

    sections: [
      {
        title: "Expenses by Date",
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "amount", label: "Amount", format: "currency" },
        ],
        rows: Array.from(byDay.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, amount]) => ({ date, amount })),
      },
    ],
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
