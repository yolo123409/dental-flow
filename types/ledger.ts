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

/**
 * Cash Flow Statement - built directly from clinic_ledger_entries/
 * transactions, looking only at entries that actually touch a
 * cash/bank/mobile-money account (never from invoices or expenses
 * directly, so accrual activity - e.g. an unpaid invoice - never appears
 * as a cash movement). Each cash-touching transaction is classified by
 * the *other* account it posts against: Accounts Receivable/Payable,
 * Inventory, or an Income/Expense account -> Operating; any other Asset
 * account -> Investing; any Liability/Equity account (other than the
 * Opening Balance Equity account, which isn't a real period cash flow) ->
 * Financing.
 */
export interface CashFlowLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface CashFlowSection {
  lines: CashFlowLine[];
  total: number;
}

export interface CashFlowPeriod {
  start: string;
  end: string;

  beginningCash: number;

  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  /**
   * Cash movements that don't reliably belong in any of the three
   * standard sections - currently only Opening Balance entries dated
   * inside the selected period (a balance-forward declaration, not a
   * real financing inflow). Shown explicitly, never silently dropped or
   * misclassified, so Beginning + Net Change always equals Ending.
   */
  other: CashFlowSection;

  netChangeInCash: number;
  endingCash: number;

  /**
   * Whether this clinic's Chart of Accounts contains any account that
   * COULD represent Investing/Financing activity, independent of whether
   * it had activity this specific period - used to tell "genuinely zero
   * this period" apart from "this clinic has never configured an account
   * to track this category at all" in the UI.
   */
  hasInvestingCapability: boolean;
  hasFinancingCapability: boolean;
}

/**
 * Balance Sheet - every account's cumulative balance as of a single
 * date, built from clinic_ledger_accounts/entries/transactions via the
 * get_balance_sheet RPC. Current vs Non-Current is derived from account
 * identity: the three special-purpose accounts
 * (cash/bank/mobile-money, Accounts Receivable, Inventory) plus any
 * other account whose name contains "Current" are Current; every other
 * Asset/Liability account is Non-Current. This matches the clinic's own
 * default Chart of Accounts (e.g. "Other Current Assets") without
 * hard-coding account IDs beyond the ones clinic_ledger_settings itself
 * already designates.
 *
 * There is no dedicated Retained Earnings account in this system, so it
 * is calculated - not fabricated - as cumulative Income minus cumulative
 * Expense, all-time up to and including the as-of date, exactly matching
 * standard accounting practice for a system that closes no books. Its
 * `lines` show every contributing Income/Expense account so the figure
 * is auditable, not a black box.
 */
export interface BalanceSheetLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface BalanceSheetSection {
  lines: BalanceSheetLine[];
  total: number;
}

export interface BalanceSheetPeriod {
  asOf: string;

  currentAssets: BalanceSheetSection;
  nonCurrentAssets: BalanceSheetSection;
  totalAssets: number;

  currentLiabilities: BalanceSheetSection;
  nonCurrentLiabilities: BalanceSheetSection;
  totalLiabilities: number;

  /** Real Equity-type ledger accounts (Owner's Equity, Opening Balance Equity, any custom account) - excludes the calculated Retained Earnings figure below. */
  equityAccounts: BalanceSheetSection;
  /** Calculated, not a ledger account: cumulative Income minus cumulative Expense as of this date. */
  retainedEarnings: BalanceSheetSection;
  totalEquity: number;

  totalLiabilitiesAndEquity: number;

  /** Assets - (Liabilities + Equity). Zero when balanced. Never silently forced to zero. */
  difference: number;
  balanced: boolean;
}
