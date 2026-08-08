export interface ExpenseCategory {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategoryInput {
  name: string;
  description?: string | null;
}

export type ExpenseStatus = "Paid" | "Voided";

export interface Expense {
  id: string;
  clinic_id: string;
  category_id: string;
  amount: number;
  expense_date: string;
  description: string;
  payee: string | null;
  supplier_id: string | null;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  receipt_path: string | null;
  status: ExpenseStatus;
  source_type: "manual";
  source_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  clinic_expense_categories?: { name: string } | null;
  clinic_suppliers?: { name: string } | null;
}

export interface ExpenseInput {
  category_id: string;
  amount: number;
  expense_date: string;
  description: string;
  payee?: string | null;
  supplier_id?: string | null;
  payment_method: string;
  reference?: string | null;
  notes?: string | null;
}

export interface ExpenseFilters {
  dateRange?: string;
  customStart?: string;
  customEnd?: string;
  categoryId?: string;
  paymentMethod?: string;
  search?: string;
}

export interface ExpenseCategoryBreakdown {
  categoryId: string;
  categoryName: string;
  total: number;
  percentage: number;
}

export interface ExpenseSummary {
  total: number;
  transactionCount: number;
  averageExpense: number;
  largestCategory: ExpenseCategoryBreakdown | null;
  breakdown: ExpenseCategoryBreakdown[];
}
