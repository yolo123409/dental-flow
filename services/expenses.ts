import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { roundMoney } from "@/lib/currency";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { getDateRange } from "./analytics/dateRange";
import { assertPermission } from "./authorization";
import { localDateString } from "@/lib/dateUtils";

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
        start: localDateString(start),
        end: localDateString(end),
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

  const bounds = resolveDateBounds(filters);

  function buildQuery(from: number, to: number) {
    let query = supabase
      .from("clinic_expenses")
      .select(EXPENSE_SELECT)
      .eq("clinic_id", clinicId)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });

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

    return query.range(from, to);
  }

  // Paged rather than a single unbounded fetch - this feeds both the
  // Money Out list and category-breakdown/P&L aggregation, and a clinic
  // with more than 1,000 expenses matching the current filters would
  // otherwise silently lose rows from both with no error.
  let data: Expense[];

  try {
    data = (await fetchAllRows(buildQuery)) as unknown as Expense[];
  } catch (error) {
    logError("[expenses] getExpenses failed:", error);

    throw error;
  }

  return data;
}

/**
 * Batched sibling of getExpenses for organization-wide aggregation
 * (services/organizations.ts#getOrganizationFinancials), which
 * previously called getExpenses (via getPeriodFinancials) once PER
 * BRANCH - found during a production-hardening audit to be a
 * contributor to that page's per-branch query fan-out at 50-branch
 * scale. The org-financials caller only ever sums Paid expenses in a
 * period, so this fetches just `clinic_id, amount` with a single
 * `.in('clinic_id', ...)` query instead of the full category/supplier-
 * joined row set. getExpenses above is untouched - every single-clinic
 * caller (Money Out page, Reports Center, Dashboard) keeps using it
 * exactly as before.
 */
export async function getPaidExpenseTotalsByClinic(
  start: Date | null,
  end: Date | null,
  clinicIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();

  if (clinicIds.length === 0) {
    return totals;
  }

  // Aggregate RPC (migration 0065), not a `.select('clinic_id, amount')`
  // fetch of every Paid expense row - that shape was found during the
  // Part 2 50-branch scale test to silently truncate at PostgREST's
  // default 1,000-row response cap once total Paid expenses across all
  // branches crossed that number, under-reporting consolidated expenses
  // with no error. This RPC returns one row PER BRANCH, never per
  // expense, so it can't hit that cap at any realistic organization size.
  const { data, error } = await supabase.rpc("get_organization_expenses_by_clinic", {
    p_clinic_ids: clinicIds,
    p_start: start ? localDateString(start) : null,
    p_end: end ? localDateString(end) : null,
  });

  if (error) {
    logError("[expenses] getPaidExpenseTotalsByClinic failed:", error);
    throw toError(error);
  }

  for (const row of data ?? []) {
    totals.set(row.clinic_id, Number(row.total ?? 0));
  }

  return totals;
}

export async function getExpense(id: string): Promise<Expense> {
  await assertPermission("money_out");

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
  await assertPermission("money_out_manage");

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
  await assertPermission("money_out_manage");

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
  await assertPermission("money_out_manage");

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
  await assertPermission("money_out_manage");

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
  await assertPermission("money_out");

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
    .gte("expense_date", localDateString(previousStart))
    .lte("expense_date", localDateString(now));

  if (error) {
    logError("[expenses] getMonthOverMonthExpenses failed:", error);

    throw toError(error);
  }

  const currentStartStr = localDateString(currentStart);
  const previousStartStr = localDateString(previousStart);
  const previousEndStr = localDateString(previousEnd);

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
