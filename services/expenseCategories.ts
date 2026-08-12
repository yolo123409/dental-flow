import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";

import { ExpenseCategory, ExpenseCategoryInput } from "@/types/expenses";

export async function getExpenseCategories(
  options: { includeInactive?: boolean } = {}
): Promise<ExpenseCategory[]> {
  const clinicId = await getCurrentClinicId();

  let query = supabase
    .from("clinic_expense_categories")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("display_order", { ascending: true });

  if (!options.includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    logError("[expenseCategories] getExpenseCategories failed:", error);

    throw toError(error);
  }

  return (data ?? []) as ExpenseCategory[];
}

export async function createExpenseCategory(
  input: ExpenseCategoryInput
): Promise<ExpenseCategory> {
  const clinicId = await getCurrentClinicId();

  const { count } = await supabase
    .from("clinic_expense_categories")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  const { data, error } = await supabase
    .from("clinic_expense_categories")
    .insert({
      clinic_id: clinicId,
      name: input.name,
      description: input.description ?? null,
      display_order: count ?? 0,
    })
    .select()
    .single();

  if (error) {
    logError("[expenseCategories] createExpenseCategory failed:", error);

    throw toError(error);
  }

  return data as ExpenseCategory;
}

export async function updateExpenseCategory(
  id: string,
  input: ExpenseCategoryInput
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_expense_categories")
    .update({
      name: input.name,
      description: input.description ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[expenseCategories] updateExpenseCategory failed:", error);

    throw toError(error);
  }
}

export async function archiveExpenseCategory(id: string): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_expense_categories")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[expenseCategories] archiveExpenseCategory failed:", error);

    throw toError(error);
  }
}

export async function reactivateExpenseCategory(id: string): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_expense_categories")
    .update({ active: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[expenseCategories] reactivateExpenseCategory failed:", error);

    throw toError(error);
  }
}

/**
 * Persists a new display order for a set of categories (drag-free
 * move-up/move-down reordering, same UX as CustomFieldsEditor). Runs as
 * one update per row rather than a single RPC since there's no
 * concurrency risk here - only one admin edits this list at a time in
 * practice, and category ordering is display-only.
 */
export async function reorderExpenseCategories(
  orderedIds: string[]
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("clinic_expense_categories")
        .update({ display_order: index, updated_at: new Date().toISOString() })
        .eq("id", id)
    )
  );

  const firstError = results.find((result) => result.error)?.error;

  if (firstError) {
    logError(
      "[expenseCategories] reorderExpenseCategories failed:",
      firstError
    );

    throw toError(firstError);
  }
}
