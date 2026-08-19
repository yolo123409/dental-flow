import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { roundMoney } from "@/lib/currency";

import { getCurrentClinicId } from "./clinic";
import { getDateRange } from "./analytics/dateRange";

import {
  Expense,
  ExpenseFilters,
  ExpenseInput,
  ExpenseSummary,
  ExpenseCategoryBreakdown,
} from "@/types/expenses";

const EXPENSE_SELECT =
  "*, clinic_expense_categories(name), clinic_suppliers(name)";

async function getCurrentClinicUserId(
  clinicId: string
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: clinicUser } = await supabase
    .from("clinic_users")
    .select("id")
    .eq("auth_user_id", user?.id ?? "")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  return clinicUser?.id ?? null;
}

function resolveDateBounds(
  filters: ExpenseFilters
): { start: string; end: string } | null {
  if (filters.dateRange === "Custom" && filters.customStart && filters.customEnd) {
    return { start: filters.customStart, end: filters.customEnd };
  }

  if (filters.dateRange) {
    const { start, end } = getDateRange(filters.dateRange);

    if (start && end) {
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
  }

  return null;
}

export async function getExpenses(
  filters: ExpenseFilters = {},
  overrideClinicId?: string
): Promise<Expense[]> {
  const clinicId = overrideClinicId ?? (await getCurrentClinicId());

  let query = supabase
    .from("clinic_expenses")
    .select(EXPENSE_SELECT)
    .eq("clinic_id", clinicId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  const bounds = resolveDateBounds(filters);

  if (bounds) {
    query = query.gte("expense_date", bounds.start).lte("expense_date", bounds.end);
  }

  if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }

  if (filters.paymentMethod) {
    query = query.eq("payment_method", filters.paymentMethod);
  }

  if (filters.search?.trim()) {
    const term = filters.search.trim();

    query = query.or(
      `description.ilike.%${term}%,payee.ilike.%${term}%,reference.ilike.%${term}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    logError("[expenses] getExpenses failed:", error);

    throw toError(error);
  }

  return (data ?? []) as unknown as Expense[];
}

export async function getExpense(id: string): Promise<Expense> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_expenses")
    .select(EXPENSE_SELECT)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    logError("[expenses] getExpense failed:", error);

    throw toError(error);
  }

  return data as unknown as Expense;
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const clinicId = await getCurrentClinicId();
  const clinicUserId = await getCurrentClinicUserId(clinicId);

  const { data, error } = await supabase
    .from("clinic_expenses")
    .insert({
      clinic_id: clinicId,
      category_id: input.category_id,
      amount: input.amount,
      expense_date: input.expense_date,
      description: input.description,
      payee: input.payee ?? null,
      supplier_id: input.supplier_id ?? null,
      payment_method: input.payment_method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      created_by: clinicUserId,
    })
    .select()
    .single();

  if (error) {
    logError("[expenses] createExpense failed:", error);

    throw toError(error);
  }

  return data as Expense;
}

export async function updateExpense(
  id: string,
  input: ExpenseInput
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_expenses")
    .update({
      category_id: input.category_id,
      amount: input.amount,
      expense_date: input.expense_date,
      description: input.description,
      payee: input.payee ?? null,
      supplier_id: input.supplier_id ?? null,
      payment_method: input.payment_method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[expenses] updateExpense failed:", error);

    throw toError(error);
  }
}

export async function voidExpense(
  id: string,
  reason: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();
  const clinicUserId = await getCurrentClinicUserId(clinicId);

  const { error } = await supabase
    .from("clinic_expenses")
    .update({
      status: "Voided",
      voided_at: new Date().toISOString(),
      voided_by: clinicUserId,
      void_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[expenses] voidExpense failed:", error);

    throw toError(error);
  }
}

/**
 * Uploads a receipt for an already-created expense and stores its storage
 * path on the row. Two steps (create expense, then attach receipt) rather
 * than one, since the storage path needs the expense's own id - mirrors
 * how PO/GRN documents are only generated after the header row exists.
 */
export async function uploadExpenseReceipt(
  expenseId: string,
  file: File
): Promise<string> {
  const allowedTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("Please upload a PNG, JPG, WEBP, or PDF file.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Receipt must be smaller than 5MB.");
  }

  const clinicId = await getCurrentClinicId();

  const extension = file.name.split(".").pop();
  const path = `${clinicId}/${expenseId}/receipt.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("expense-receipts")
    .upload(path, file, { upsert: true });

  if (uploadError) {
    logError("[expenses] uploadExpenseReceipt failed:", uploadError);

    throw toError(uploadError);
  }

  const { error: updateError } = await supabase
    .from("clinic_expenses")
    .update({ receipt_path: path, updated_at: new Date().toISOString() })
    .eq("id", expenseId);

  if (updateError) {
    logError(
      "[expenses] uploadExpenseReceipt (save path) failed:",
      updateError
    );

    throw toError(updateError);
  }

  return path;
}

/**
 * expense-receipts is a private bucket (financial records, not something
 * meant to be reachable via a public URL like the clinic logo), so
 * viewing a receipt goes through a short-lived signed URL instead of
 * getPublicUrl().
 */
export async function getExpenseReceiptUrl(
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(path, 60);

  if (error) {
    logError("[expenses] getExpenseReceiptUrl failed:", error);

    throw toError(error);
  }

  return data.signedUrl;
}

function summarize(expenses: Expense[]): ExpenseSummary {
  const total = roundMoney(
    expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  );

  const byCategory = new Map<string, { name: string; total: number }>();

  for (const expense of expenses) {
    const existing = byCategory.get(expense.category_id);
    const categoryName =
      expense.clinic_expense_categories?.name ?? "Uncategorized";

    byCategory.set(expense.category_id, {
      name: categoryName,
      total: (existing?.total ?? 0) + Number(expense.amount),
    });
  }

  const breakdown: ExpenseCategoryBreakdown[] = Array.from(
    byCategory.entries()
  )
    .map(([categoryId, { name, total: categoryTotal }]) => ({
      categoryId,
      categoryName: name,
      total: roundMoney(categoryTotal),
      percentage: total > 0 ? roundMoney((categoryTotal / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    transactionCount: expenses.length,
    averageExpense:
      expenses.length > 0 ? roundMoney(total / expenses.length) : 0,
    largestCategory: breakdown[0] ?? null,
    breakdown,
  };
}

export async function getExpenseSummary(
  dateRange: string
): Promise<ExpenseSummary> {
  const expenses = await getExpenses({ dateRange });

  return summarize(expenses.filter((expense) => expense.status === "Paid"));
}

export interface MonthOverMonthExpenses {
  current: number;
  previous: number;
  diffAmount: number;
  diffPercent: number | null;
}

export async function getMonthOverMonthExpenses(): Promise<MonthOverMonthExpenses> {
  const now = new Date();

  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_expenses")
    .select("amount, expense_date")
    .eq("clinic_id", clinicId)
    .eq("status", "Paid")
    .gte("expense_date", previousStart.toISOString().slice(0, 10))
    .lte("expense_date", now.toISOString().slice(0, 10));

  if (error) {
    logError("[expenses] getMonthOverMonthExpenses failed:", error);

    throw toError(error);
  }

  const currentStartStr = currentStart.toISOString().slice(0, 10);
  const previousStartStr = previousStart.toISOString().slice(0, 10);
  const previousEndStr = previousEnd.toISOString().slice(0, 10);

  const current = roundMoney(
    (data ?? [])
      .filter((row) => row.expense_date >= currentStartStr)
      .reduce((sum, row) => sum + Number(row.amount), 0)
  );

  const previous = roundMoney(
    (data ?? [])
      .filter(
        (row) =>
          row.expense_date >= previousStartStr &&
          row.expense_date <= previousEndStr
      )
      .reduce((sum, row) => sum + Number(row.amount), 0)
  );

  const diffAmount = roundMoney(current - previous);

  return {
    current,
    previous,
    diffAmount,
    diffPercent: previous > 0 ? roundMoney((diffAmount / previous) * 100) : null,
  };
}
