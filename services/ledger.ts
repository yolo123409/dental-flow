import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getPeriodFinancials } from "./reports/shared";

import {
  AccountLedger,
  LedgerAccount,
  LedgerAccountType,
  LedgerDashboardTotals,
  LedgerReconciliationIssue,
  LedgerSettings,
  LedgerTransaction,
  LedgerTransactionFilters,
  LedgerTransactionPage,
  TrialBalance,
  TrialBalanceRow,
} from "@/types/ledger";

const TRANSACTION_SELECT = `
  *,
  patients ( first_name, last_name ),
  clinic_suppliers ( name ),
  clinic_users ( full_name ),
  clinic_ledger_entries (
    *,
    clinic_ledger_accounts ( code, name, type )
  )
`;

let provisioned = false;

/**
 * The chart of accounts/settings are seeded lazily on first use (same
 * pattern as switch_active_branch's lazy clinic_users provisioning
 * elsewhere in this project) rather than requiring a migration-time data
 * backfill for every existing clinic. Cached in-memory per session so
 * repeated calls within one page load don't re-invoke the RPC.
 */
export async function ensureLedgerProvisioned(): Promise<void> {
  if (provisioned) return;

  const { error } = await supabase.rpc("ensure_ledger_provisioned");

  if (error) {
    logError("[ledger] ensureLedgerProvisioned failed:", error);
    throw toError(error);
  }

  provisioned = true;
}

/* -------------------------------------- */
/* Chart of Accounts                      */
/* -------------------------------------- */

export async function getLedgerAccounts(
  options: { includeInactive?: boolean } = {}
): Promise<LedgerAccount[]> {
  await ensureLedgerProvisioned();

  const clinicId = await getCurrentClinicId();

  let query = supabase
    .from("clinic_ledger_accounts")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("code");

  if (!options.includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    logError("[ledger] getLedgerAccounts failed:", error);
    throw toError(error);
  }

  return (data ?? []) as LedgerAccount[];
}

export interface LedgerAccountInput {
  code: string;
  name: string;
  type: LedgerAccountType;
}

export async function createLedgerAccount(input: LedgerAccountInput): Promise<LedgerAccount> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_ledger_accounts")
    .insert({
      clinic_id: clinicId,
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
    })
    .select()
    .single();

  if (error) {
    logError("[ledger] createLedgerAccount failed:", error);
    throw toError(error);
  }

  return data as LedgerAccount;
}

export async function updateLedgerAccount(
  id: string,
  input: Partial<LedgerAccountInput>
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_ledger_accounts")
    .update({
      ...(input.code !== undefined && { code: input.code.trim() }),
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.type !== undefined && { type: input.type }),
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError("[ledger] updateLedgerAccount failed:", error);
    throw toError(error);
  }
}

/**
 * Accounts are never hard-deleted (an account with ledger history must
 * stay intact) - only ever deactivated, matching section 5 exactly.
 */
export async function setLedgerAccountActive(id: string, active: boolean): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_ledger_accounts")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError("[ledger] setLedgerAccountActive failed:", error);
    throw toError(error);
  }
}

/* -------------------------------------- */
/* Settings / default mappings            */
/* -------------------------------------- */

export async function getLedgerSettings(): Promise<LedgerSettings> {
  await ensureLedgerProvisioned();

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_ledger_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    logError("[ledger] getLedgerSettings failed:", error);
    throw toError(error);
  }

  return data as LedgerSettings;
}

export async function updateLedgerSettings(
  input: Partial<
    Omit<LedgerSettings, "clinic_id" | "updated_at">
  >
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_ledger_settings")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[ledger] updateLedgerSettings failed:", error);
    throw toError(error);
  }
}

export async function setExpenseCategoryAccount(
  categoryId: string,
  accountId: string | null
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_expense_categories")
    .update({ default_ledger_account_id: accountId, updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("id", categoryId);

  if (error) {
    logError("[ledger] setExpenseCategoryAccount failed:", error);
    throw toError(error);
  }
}

/* -------------------------------------- */
/* Transactions                           */
/* -------------------------------------- */

const DEFAULT_PAGE_SIZE = 25;

export async function getLedgerTransactions(
  filters: LedgerTransactionFilters = {}
): Promise<LedgerTransactionPage> {
  const clinicId = await getCurrentClinicId();

  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
  const offset = filters.offset ?? 0;

  // Filtering by account requires knowing which transactions have an
  // entry against that account - resolved as a separate lookup rather
  // than an embedded-resource filter, so the returned
  // clinic_ledger_entries arrays always contain every entry of a
  // transaction (not just the one matching the filter).
  let transactionIdsForAccount: string[] | null = null;

  if (filters.accountId) {
    const { data: entryRows, error: entryError } = await supabase
      .from("clinic_ledger_entries")
      .select("transaction_id")
      .eq("clinic_id", clinicId)
      .eq("account_id", filters.accountId);

    if (entryError) {
      logError("[ledger] getLedgerTransactions (account filter) failed:", entryError);
      throw toError(entryError);
    }

    transactionIdsForAccount = Array.from(
      new Set((entryRows ?? []).map((row) => row.transaction_id))
    );

    if (transactionIdsForAccount.length === 0) {
      return { rows: [], count: 0 };
    }
  }

  let query = supabase
    .from("clinic_ledger_transactions")
    .select(TRANSACTION_SELECT, { count: "exact" })
    .eq("clinic_id", clinicId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (transactionIdsForAccount) {
    query = query.in("id", transactionIdsForAccount);
  }

  if (filters.startDate) query = query.gte("transaction_date", filters.startDate);
  if (filters.endDate) query = query.lte("transaction_date", filters.endDate);
  if (filters.transactionType) query = query.eq("transaction_type", filters.transactionType);
  if (filters.referenceType) query = query.eq("reference_type", filters.referenceType);
  if (filters.patientId) query = query.eq("patient_id", filters.patientId);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.search?.trim()) {
    query = query.ilike("description", `%${filters.search.trim()}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    logError("[ledger] getLedgerTransactions failed:", error);
    throw toError(error);
  }

  return { rows: (data ?? []) as unknown as LedgerTransaction[], count: count ?? 0 };
}

export async function getLedgerTransaction(id: string): Promise<LedgerTransaction> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_ledger_transactions")
    .select(TRANSACTION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) {
    logError("[ledger] getLedgerTransaction failed:", error);
    throw toError(error);
  }

  return data as unknown as LedgerTransaction;
}

/* -------------------------------------- */
/* Manual journal / reversal / opening    */
/* -------------------------------------- */

export interface ManualJournalEntryInput {
  transactionDate: string;
  description: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  notes?: string;
}

export async function createManualJournalEntry(
  input: ManualJournalEntryInput
): Promise<string> {
  const { data, error } = await supabase.rpc("create_manual_journal_entry", {
    p_transaction_date: input.transactionDate,
    p_description: input.description,
    p_debit_account_id: input.debitAccountId,
    p_credit_account_id: input.creditAccountId,
    p_amount: input.amount,
    p_notes: input.notes ?? null,
  });

  if (error) {
    logError("[ledger] createManualJournalEntry failed:", error);
    throw toError(error);
  }

  return data as string;
}

export async function reverseLedgerTransaction(
  transactionId: string,
  notes?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("reverse_ledger_transaction", {
    p_transaction_id: transactionId,
    p_notes: notes ?? null,
  });

  if (error) {
    logError("[ledger] reverseLedgerTransaction failed:", error);
    throw toError(error);
  }

  return data as string;
}

export async function setOpeningBalance(
  accountId: string,
  amount: number,
  asOf?: string
): Promise<void> {
  const { error } = await supabase.rpc("set_opening_balance", {
    p_account_id: accountId,
    p_amount: amount,
    p_as_of: asOf ?? new Date().toISOString().slice(0, 10),
  });

  if (error) {
    logError("[ledger] setOpeningBalance failed:", error);
    throw toError(error);
  }
}

/* -------------------------------------- */
/* Trial balance                          */
/* -------------------------------------- */

interface RawTrialBalanceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: LedgerAccountType;
  total_debit: number;
  total_credit: number;
}

export async function getTrialBalance(): Promise<TrialBalance> {
  await ensureLedgerProvisioned();

  const { data, error } = await supabase.rpc("get_trial_balance");

  if (error) {
    logError("[ledger] getTrialBalance failed:", error);
    throw toError(error);
  }

  const rows: TrialBalanceRow[] = ((data ?? []) as RawTrialBalanceRow[]).map((row) => {
    const net = Number(row.total_debit) - Number(row.total_credit);

    return {
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      accountType: row.account_type,
      totalDebit: Number(row.total_debit),
      totalCredit: Number(row.total_credit),
      debitBalance: net > 0 ? net : 0,
      creditBalance: net < 0 ? -net : 0,
    };
  });

  const totalDebits = rows.reduce((sum, row) => sum + row.debitBalance, 0);
  const totalCredits = rows.reduce((sum, row) => sum + row.creditBalance, 0);

  return {
    rows,
    totalDebits,
    totalCredits,
    // Rounds to cents before comparing - floating point summation of
    // many rows can differ by fractions of a cent even when genuinely
    // balanced. A real imbalance (a bug, not float noise) will always be
    // far larger than one cent.
    balanced: Math.abs(totalDebits - totalCredits) < 0.01,
  };
}

/* -------------------------------------- */
/* General Ledger (per account)           */
/* -------------------------------------- */

interface RawAccountLedgerRow {
  transaction_id: string;
  transaction_date: string;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  debit: number;
  credit: number;
  running_balance: number;
}

export async function getAccountLedger(
  accountId: string,
  start: string | null,
  end: string | null
): Promise<AccountLedger> {
  const clinicId = await getCurrentClinicId();

  const [{ data: accountData, error: accountError }, openingResult, rowsResult] =
    await Promise.all([
      supabase
        .from("clinic_ledger_accounts")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("id", accountId)
        .single(),
      start
        ? supabase.rpc("get_account_opening_balance", { p_account_id: accountId, p_start: start })
        : Promise.resolve({ data: 0, error: null }),
      supabase.rpc("get_account_ledger", {
        p_account_id: accountId,
        p_start: start,
        p_end: end,
      }),
    ]);

  if (accountError) {
    logError("[ledger] getAccountLedger (account) failed:", accountError);
    throw toError(accountError);
  }

  if (openingResult.error) {
    logError("[ledger] getAccountLedger (opening balance) failed:", openingResult.error);
    throw toError(openingResult.error);
  }

  if (rowsResult.error) {
    logError("[ledger] getAccountLedger (rows) failed:", rowsResult.error);
    throw toError(rowsResult.error);
  }

  const openingBalance = Number(openingResult.data ?? 0);

  const rows = ((rowsResult.data ?? []) as RawAccountLedgerRow[]).map((row) => ({
    transactionId: row.transaction_id,
    transactionDate: row.transaction_date,
    description: row.description,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    debit: Number(row.debit),
    credit: Number(row.credit),
    runningBalance: openingBalance + Number(row.running_balance),
  }));

  return {
    account: accountData as LedgerAccount,
    openingBalance,
    rows,
    closingBalance: rows.length > 0 ? rows[rows.length - 1].runningBalance : openingBalance,
  };
}

/* -------------------------------------- */
/* Reconciliation issues                  */
/* -------------------------------------- */

export async function getReconciliationIssues(
  options: { includeResolved?: boolean } = {}
): Promise<LedgerReconciliationIssue[]> {
  const clinicId = await getCurrentClinicId();

  let query = supabase
    .from("clinic_ledger_reconciliation_issues")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (!options.includeResolved) {
    query = query.eq("resolved", false);
  }

  const { data, error } = await query;

  if (error) {
    logError("[ledger] getReconciliationIssues failed:", error);
    throw toError(error);
  }

  return (data ?? []) as LedgerReconciliationIssue[];
}

/* -------------------------------------- */
/* Dashboard                              */
/* -------------------------------------- */

/**
 * Cash & Bank / Accounts Receivable / Accounts Payable / Inventory are
 * genuinely ledger-only figures - computed here from the trial balance.
 * Revenue / Expenses / Net Profit deliberately reuse
 * services/reports/shared.ts#getPeriodFinancials (the exact same
 * calculation the Reports Center's P&L and Monthly Comparison already
 * use) rather than a second computation, per the spec's explicit
 * "do not duplicate calculations unnecessarily" (section 27).
 */
export async function getLedgerDashboardTotals(
  start: Date | null,
  end: Date | null
): Promise<LedgerDashboardTotals> {
  const [settings, trialBalance, financials, issues] = await Promise.all([
    getLedgerSettings(),
    getTrialBalance(),
    getPeriodFinancials(start, end),
    getReconciliationIssues(),
  ]);

  const balanceFor = (accountId: string | null, side: "debit" | "credit"): number => {
    if (!accountId) return 0;

    const row = trialBalance.rows.find((r) => r.accountId === accountId);
    if (!row) return 0;

    return side === "debit" ? row.debitBalance : row.creditBalance;
  };

  const cashAccountIds = new Set<string>(
    [
      settings.default_cash_account_id,
      ...Object.values(settings.payment_method_accounts ?? {}),
    ].filter((id): id is string => !!id)
  );

  const cashAndBank = Array.from(cashAccountIds).reduce(
    (sum, id) => sum + balanceFor(id, "debit"),
    0
  );

  return {
    cashAndBank,
    accountsReceivable: balanceFor(settings.accounts_receivable_account_id, "debit"),
    accountsPayable: balanceFor(settings.accounts_payable_account_id, "credit"),
    inventory: balanceFor(settings.inventory_account_id, "debit"),
    revenue: financials.revenue,
    expenses: financials.expenses,
    netProfit: financials.netProfit,
    openReconciliationIssues: issues.length,
  };
}
