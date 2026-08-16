export type LedgerAccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export interface LedgerAccount {
  id: string;
  clinic_id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LedgerSettings {
  clinic_id: string;
  treatment_revenue_account_id: string | null;
  accounts_receivable_account_id: string | null;
  inventory_account_id: string | null;
  accounts_payable_account_id: string | null;
  supplies_used_account_id: string | null;
  default_expense_account_id: string | null;
  default_cash_account_id: string | null;
  opening_balance_equity_account_id: string | null;
  payment_method_accounts: Record<string, string>;
  updated_at: string;
}

export type LedgerTransactionType =
  | "Invoice"
  | "Payment"
  | "Expense"
  | "InventoryReceipt"
  | "InventoryConsumption"
  | "InventoryReturn"
  | "ManualJournal"
  | "Reversal"
  | "OpeningBalance";

export interface LedgerEntry {
  id: string;
  clinic_id: string;
  transaction_id: string;
  account_id: string;
  debit: number;
  credit: number;
  created_at: string;
  clinic_ledger_accounts?: { code: string; name: string; type: LedgerAccountType } | null;
}

export interface LedgerTransaction {
  id: string;
  clinic_id: string;
  transaction_date: string;
  transaction_type: LedgerTransactionType;
  reference_type: string | null;
  reference_id: string | null;
  description: string;
  currency: string;
  patient_id: string | null;
  supplier_id: string | null;
  created_by: string | null;
  created_at: string;
  reverses_transaction_id: string | null;
  reversed_by: string | null;

  clinic_ledger_entries?: LedgerEntry[];
  patients?: { first_name: string; last_name: string } | null;
  clinic_suppliers?: { name: string } | null;
  clinic_users?: { full_name: string } | null;
}

export interface LedgerTransactionFilters {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  transactionType?: LedgerTransactionType;
  referenceType?: string;
  patientId?: string;
  supplierId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LedgerTransactionPage {
  rows: LedgerTransaction[];
  count: number;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: LedgerAccountType;
  totalDebit: number;
  totalCredit: number;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

export interface AccountLedgerRow {
  transactionId: string;
  transactionDate: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedger {
  account: LedgerAccount;
  openingBalance: number;
  rows: AccountLedgerRow[];
  closingBalance: number;
}

export interface LedgerReconciliationIssue {
  id: string;
  clinic_id: string;
  reference_type: string;
  reference_id: string | null;
  issue: string;
  resolved: boolean;
  created_at: string;
}

export interface LedgerDashboardTotals {
  cashAndBank: number;
  accountsReceivable: number;
  accountsPayable: number;
  inventory: number;
  revenue: number;
  expenses: number;
  netProfit: number;
  openReconciliationIssues: number;
}

/**
 * Profit & Loss - built from clinic_ledger_accounts/entries/transactions
 * (the same double-entry source of truth as the Trial Balance and General
 * Ledger), not from summing invoices/payments/expenses directly. Each
 * line's `amount` is already sign-adjusted for its account's normal
 * balance side (revenue lines are positive when the account has a net
 * credit balance, expense lines are positive when the account has a net
 * debit balance) so every amount in the UI can be shown and summed as a
 * plain positive figure.
 */
export interface ProfitAndLossLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface ProfitAndLossSection {
  lines: ProfitAndLossLine[];
  total: number;
}

export interface ProfitAndLossPeriod {
  start: string;
  end: string;
  revenue: ProfitAndLossSection;
  directCosts: ProfitAndLossSection;
  grossProfit: number;
  operatingExpenses: ProfitAndLossSection;
  totalOperatingExpenses: number;
  ebit: number;
  netProfit: number;
  /**
   * Only ever populated when the clinic's own Chart of Accounts contains
   * a Depreciation/Amortization expense account to add back - never
   * estimated. Null means "not reliably computable from the accounts
   * that exist", not zero.
   */
  ebitda: number | null;
}
