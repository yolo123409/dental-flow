import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import {
  AccountLedger,
  BalanceSheetLine,
  BalanceSheetPeriod,
  BalanceSheetSection,
  CashFlowLine,
  CashFlowPeriod,
  CashFlowSection,
  EbitEbitdaPeriod,
  LedgerAccount,
  LedgerAccountType,
  LedgerDashboardTotals,
  LedgerReconciliationIssue,
  LedgerSettings,
  LedgerTransaction,
  LedgerTransactionFilters,
  LedgerTransactionPage,
  ProfitAndLossLine,
  ProfitAndLossPeriod,
  ProfitAndLossSection,
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

let provisionedClinicId: string | null = null;
let provisioningPromise: Promise<void> | null = null;
let provisioningClinicId: string | null = null;

/**
 * The chart of accounts/settings are seeded lazily on first use (same
 * pattern as switch_active_branch's lazy clinic_users provisioning
 * elsewhere in this project) rather than requiring a migration-time data
 * backfill for every existing clinic. Cached in-memory per session so
 * repeated calls within one page load don't re-invoke the RPC - keyed by
 * clinic id (not a bare boolean) so switching to a different branch
 * within the same session correctly re-provisions the newly-active
 * branch instead of assuming "already provisioned" from a different
 * branch's earlier call.
 *
 * Callers like getLedgerDashboardTotals() invoke this via multiple
 * services (getLedgerSettings(), getTrialBalance()) in parallel through
 * Promise.all, so the `provisionedClinicId` check alone isn't enough -
 * two calls can both see it as unprovisioned before either has resolved.
 * In-flight calls for the same clinic share a single promise so only one
 * RPC request is ever sent at a time (the RPC itself is also idempotent
 * server-side, guarding against the same race across separate tabs/
 * sessions).
 */
export async function ensureLedgerProvisioned(overrideClinicId?: string): Promise<void> {
  const clinicId = overrideClinicId ?? (await getCurrentClinicId());

  if (provisionedClinicId === clinicId) return;

  if (provisioningPromise && provisioningClinicId === clinicId) {
    return provisioningPromise;
  }

  provisioningClinicId = clinicId;

  provisioningPromise = (async () => {
    try {
      const { error } = await supabase.rpc("ensure_ledger_provisioned", {
        p_clinic_id: clinicId,
      });

      if (error) {
        logError("[ledger] ensureLedgerProvisioned failed:", error);
        throw toError(error);
      }

      provisionedClinicId = clinicId;
    } finally {
      provisioningPromise = null;
      provisioningClinicId = null;
    }
  })();

  return provisioningPromise;
}

/* -------------------------------------- */
/* Chart of Accounts                      */
/* -------------------------------------- */

export async function getLedgerAccounts(
  options: { includeInactive?: boolean } = {}
): Promise<LedgerAccount[]> {
  await assertPermission("ledger");
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
  await assertPermission("ledger_manage");
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
  await assertPermission("ledger_manage");
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
  await assertPermission("ledger_manage");
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

export async function getLedgerSettings(overrideClinicId?: string): Promise<LedgerSettings> {
  await assertPermission("ledger");
  await ensureLedgerProvisioned(overrideClinicId);

  const clinicId = overrideClinicId ?? (await getCurrentClinicId());

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
  await assertPermission("ledger_manage");
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
  await assertPermission("ledger_manage");
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
  await assertPermission("ledger");
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
    // Paged rather than a single unbounded fetch - an active Cash or
    // Accounts Receivable account can plausibly accumulate more than
    // 1,000 entries over a clinic's lifetime, which would otherwise
    // silently truncate `transactionIdsForAccount` and make this filter
    // miss real transactions with no error.
    const entryRows = await fetchAllRows<{ transaction_id: string }>((from, to) =>
      supabase
        .from("clinic_ledger_entries")
        .select("transaction_id")
        .eq("clinic_id", clinicId)
        .eq("account_id", filters.accountId as string)
        .order("transaction_id")
        .range(from, to)
    );

    transactionIdsForAccount = Array.from(
      new Set(entryRows.map((row) => row.transaction_id))
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

/**
 * Fetches every matching transaction for a report that genuinely needs
 * full transaction detail (not just a sum) - Cash Flow, the AP Days
 * ratio, Stock Days - by paging through getLedgerTransactions's own
 * real `.range()` pagination instead of asking for one giant page.
 *
 * Found live during the Part 2 row-cap audit: all three of those callers
 * previously called `getLedgerTransactions({ ..., limit: 10000 })`,
 * which is still just ONE request for `.range(0, 9999)` - Supabase/
 * PostgREST caps the actual rows returned at 1,000 (the project's
 * max-rows setting) regardless of how large a range is requested, with
 * no error. Cash Flow could silently omit real cash movements past the
 * 1,000th transaction; AP Days/Stock Days could silently understate.
 */
export async function getAllLedgerTransactions(
  filters: Omit<LedgerTransactionFilters, "limit" | "offset">
): Promise<LedgerTransaction[]> {
  const PAGE_SIZE = 1000;
  const all: LedgerTransaction[] = [];
  let offset = 0;

  for (;;) {
    const page = await getLedgerTransactions({
      ...filters,
      limit: PAGE_SIZE,
      offset,
    });

    all.push(...page.rows);

    if (page.rows.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return all;
}

export async function getLedgerTransaction(id: string): Promise<LedgerTransaction> {
  await assertPermission("ledger");
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
  await assertPermission("ledger_manage");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase.rpc("create_manual_journal_entry", {
    p_clinic_id: clinicId,
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
  await assertPermission("ledger_manage");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase.rpc("reverse_ledger_transaction", {
    p_clinic_id: clinicId,
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
  await assertPermission("ledger_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase.rpc("set_opening_balance", {
    p_clinic_id: clinicId,
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
  await assertPermission("ledger");
  await ensureLedgerProvisioned();

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase.rpc("get_trial_balance", {
    p_clinic_id: clinicId,
  });

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
  await assertPermission("ledger");
  const clinicId = await getCurrentClinicId();

  const [{ data: accountData, error: accountError }, openingResult, rawRows] =
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
      // get_account_ledger's own SQL orders deterministically
      // (transaction_date, transaction_id - the same order its running-
      // balance window function uses), which is what makes paging
      // through it via .range() safe: each page is a stable slice of the
      // same ordering, not a single `select *` that PostgREST would
      // silently cap at 1,000 rows regardless of how many ledger entries
      // this account actually has in the period - found live during the
      // Part 2 row-cap audit to corrupt closingBalance below (it read
      // the LAST row of whatever the server happened to return, not the
      // account's true final balance) for any account with more than
      // 1,000 entries in the queried range.
      fetchAllRows<RawAccountLedgerRow>((from, to) =>
        supabase
          .rpc("get_account_ledger", {
            p_account_id: accountId,
            p_start: start,
            p_end: end,
          })
          .range(from, to)
      ),
    ]);

  if (accountError) {
    logError("[ledger] getAccountLedger (account) failed:", accountError);
    throw toError(accountError);
  }

  if (openingResult.error) {
    logError("[ledger] getAccountLedger (opening balance) failed:", openingResult.error);
    throw toError(openingResult.error);
  }

  const openingBalance = Number(openingResult.data ?? 0);

  const rows = rawRows.map((row) => ({
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
  await assertPermission("ledger");
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
 *
 * FIN-1: Revenue / Expenses / Net Profit now come directly from
 * getProfitAndLoss() (this same file) - the identical figures the
 * dedicated Ledger P&L page shows for the same period. Before FIN-1 these
 * three fields reused services/reports/shared.ts#getPeriodFinancials,
 * which computed them independently from clinic_invoices/clinic_expenses/
 * clinic_treatments on a "Paid invoices" basis rather than the ledger's
 * accrual one - so the Ledger Dashboard's own Revenue/Expenses/Net Profit
 * tiles could silently disagree with the Ledger's own P&L page one click
 * away. See the FIN-0 audit, finding P1-1. There is still exactly one
 * accounting calculation, not two - it's just getProfitAndLoss() itself
 * now, rather than a second function that happened to reuse the same
 * numbers as this one.
 */
export async function getLedgerDashboardTotals(
  start: Date | null,
  end: Date | null
): Promise<LedgerDashboardTotals> {
  await assertPermission("ledger");

  const periodStart = start ?? new Date(0);
  const periodEnd = end ?? new Date();

  const [settings, trialBalance, profitAndLoss, issues] = await Promise.all([
    getLedgerSettings(),
    getTrialBalance(),
    getProfitAndLoss(periodStart, periodEnd),
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
    revenue: profitAndLoss.revenue.total,
    expenses: profitAndLoss.totalOperatingExpenses,
    netProfit: profitAndLoss.netProfit,
    openReconciliationIssues: issues.length,
  };
}

/* -------------------------------------- */
/* Profit & Loss                          */
/* -------------------------------------- */

interface RawProfitAndLossRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: LedgerAccountType;
  total_debit: number;
  total_credit: number;
}

interface RawProfitAndLossRowMulti extends RawProfitAndLossRow {
  clinic_id: string;
}

const DEPRECIATION_NAME_PATTERN = /deprecia|amortiz/i;

/**
 * Pure: given one clinic's raw get_profit_and_loss rows and that same
 * clinic's ledger settings, computes its ProfitAndLossPeriod. Extracted
 * so the batched multi-clinic path (getProfitAndLossForClinics, used by
 * the CEO Consolidated Financials page) and the single-clinic path
 * (getProfitAndLoss) share one computation - the only thing that differs
 * between them is how the rows/settings are fetched (one query per
 * clinic vs. one batched query for every clinic), never the arithmetic.
 * That's what makes "the batched total is the same number a CEO would
 * see visiting each branch individually" true by construction rather
 * than by hoping two hand-written copies never drift apart.
 */
function computeProfitAndLossFromRows(
  rows: RawProfitAndLossRow[],
  settings: LedgerSettings,
  startIso: string,
  endIso: string
): ProfitAndLossPeriod {
  const incomeRows = rows
    .filter((row) => row.account_type === "Income")
    .map((row) => ({
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      // Income accounts are credit-normal: net credit movement is the
      // period's revenue for that account.
      amount: Number(row.total_credit) - Number(row.total_debit),
    }));

  const expenseRows = rows.filter((row) => row.account_type === "Expense");

  const directCostRows = expenseRows
    .filter((row) => row.account_id === settings.supplies_used_account_id)
    .map((row) => ({
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      // Expense accounts are debit-normal: net debit movement is the
      // period's cost for that account.
      amount: Number(row.total_debit) - Number(row.total_credit),
    }));

  const operatingExpenseRows = expenseRows
    .filter((row) => row.account_id !== settings.supplies_used_account_id)
    .map((row) => ({
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      amount: Number(row.total_debit) - Number(row.total_credit),
    }));

  const revenue = buildSection(incomeRows);
  const directCosts = buildSection(directCostRows);
  const operatingExpenses = buildSection(operatingExpenseRows);

  const grossProfit = revenue.total - directCosts.total;
  const totalOperatingExpenses = operatingExpenses.total;
  const ebit = grossProfit - totalOperatingExpenses;

  // No interest/tax accounts exist in this clinic's ledger design, so
  // there is nothing to separate out below EBIT - Net Profit and EBIT
  // are the same figure until such accounts exist.
  const netProfit = ebit;

  const depreciationTotal = operatingExpenses.lines
    .filter((line) => DEPRECIATION_NAME_PATTERN.test(line.accountName))
    .reduce((sum, line) => sum + line.amount, 0);

  const ebitda = depreciationTotal > 0 ? ebit + depreciationTotal : null;

  return {
    start: startIso,
    end: endIso,
    revenue,
    directCosts,
    grossProfit,
    operatingExpenses,
    totalOperatingExpenses,
    ebit,
    netProfit,
    ebitda,
  };
}

function buildSection(
  rows: { accountId: string; accountCode: string; accountName: string; amount: number }[]
): ProfitAndLossSection {
  const lines: ProfitAndLossLine[] = rows
    .filter((row) => row.amount !== 0)
    .map((row) => ({
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      amount: row.amount,
    }));

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
  };
}

/**
 * Profit & Loss for a single period, built entirely from the double-entry
 * ledger (clinic_ledger_accounts/entries/transactions via the
 * get_profit_and_loss RPC) - never from summing invoices, payments, or
 * clinic_expenses rows directly. This is a read-only report: it never
 * writes to any accounting table.
 *
 * Revenue = net credit movement on Income accounts in the period.
 * Direct Costs = the Expense account the clinic's own ledger settings
 * designate for inventory consumed in delivering treatments
 * (supplies_used_account_id) - the existing system's own "cost of goods
 * sold" classification, not an invented category. Every other Expense
 * account is an Operating Expense, using whatever account each expense
 * category (or the clinic's default) is actually mapped to - so the
 * breakdown always matches this clinic's real Chart of Accounts.
 *
 * EBITDA is only populated when the clinic's own chart contains an
 * account that is clearly Depreciation/Amortization (by name) - there is
 * no such account in the default seeded chart, so most clinics will see
 * null here, which the UI must render as "not available", never as 0.
 */
export async function getProfitAndLoss(
  start: Date,
  end: Date,
  overrideClinicId?: string
): Promise<ProfitAndLossPeriod> {
  await assertPermission("ledger");

  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const clinicId = overrideClinicId ?? (await getCurrentClinicId());

  const [settings, rpcResult] = await Promise.all([
    getLedgerSettings(overrideClinicId),
    supabase.rpc("get_profit_and_loss", {
      p_clinic_id: clinicId,
      p_start: startIso,
      p_end: endIso,
    }),
  ]);

  if (rpcResult.error) {
    logError("[ledger] getProfitAndLoss failed:", rpcResult.error);
    throw toError(rpcResult.error);
  }

  const rows = (rpcResult.data ?? []) as RawProfitAndLossRow[];

  return computeProfitAndLossFromRows(rows, settings, startIso, endIso);
}

/**
 * Batched form of getProfitAndLoss for every branch of an organization at
 * once - one ensure-provisioned call, one settings query, one RPC call,
 * regardless of branch count, instead of 3 x N. Used by the CEO
 * Consolidated Financials page's EBIT/EBITDA figures (via
 * getEbitEbitdaForClinics below) and available directly for any future
 * multi-branch P&L view. Returns a Map so a caller can look up any
 * branch's period by its clinic id; a branch with no ledger activity at
 * all in the period still gets an entry (all-zero sections), matching
 * what calling getProfitAndLoss for that one branch would return.
 */
export async function getProfitAndLossForClinics(
  clinicIds: string[],
  start: Date,
  end: Date
): Promise<Map<string, ProfitAndLossPeriod>> {
  await assertPermission("ledger");

  const results = new Map<string, ProfitAndLossPeriod>();

  if (clinicIds.length === 0) {
    return results;
  }

  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const { error: provisionError } = await supabase.rpc(
    "ensure_ledger_provisioned_multi",
    { p_clinic_ids: clinicIds }
  );

  if (provisionError) {
    logError(
      "[ledger] getProfitAndLossForClinics failed to provision:",
      provisionError
    );

    throw toError(provisionError);
  }

  const [settingsResult, rpcResult] = await Promise.all([
    supabase
      .from("clinic_ledger_settings")
      .select("*")
      .in("clinic_id", clinicIds),
    supabase.rpc("get_profit_and_loss_multi", {
      p_clinic_ids: clinicIds,
      p_start: startIso,
      p_end: endIso,
    }),
  ]);

  if (settingsResult.error) {
    logError(
      "[ledger] getProfitAndLossForClinics failed to load settings:",
      settingsResult.error
    );

    throw toError(settingsResult.error);
  }

  if (rpcResult.error) {
    logError(
      "[ledger] getProfitAndLossForClinics failed:",
      rpcResult.error
    );

    throw toError(rpcResult.error);
  }

  const settingsByClinicId = new Map<string, LedgerSettings>(
    (settingsResult.data ?? []).map((row) => [
      row.clinic_id as string,
      row as LedgerSettings,
    ])
  );

  const rowsByClinicId = new Map<string, RawProfitAndLossRow[]>();

  for (const row of (rpcResult.data ?? []) as RawProfitAndLossRowMulti[]) {
    const existing = rowsByClinicId.get(row.clinic_id) ?? [];
    existing.push(row);
    rowsByClinicId.set(row.clinic_id, existing);
  }

  for (const clinicId of clinicIds) {
    const settings = settingsByClinicId.get(clinicId);

    // No settings row - branch has never had any ledger activity and was
    // never lazily provisioned before now (ensure_ledger_provisioned_multi
    // above only provisions branches the caller is a genuine member of;
    // if this ever happens it means the caller isn't actually a member of
    // this branch, so it's correctly excluded rather than guessed at).
    if (!settings) {
      continue;
    }

    const rows = rowsByClinicId.get(clinicId) ?? [];

    results.set(
      clinicId,
      computeProfitAndLossFromRows(rows, settings, startIso, endIso)
    );
  }

  return results;
}

/* -------------------------------------- */
/* Cash Flow Statement                    */
/* -------------------------------------- */

/**
 * Cash Flow Statement for a single period - a direct-method statement
 * built entirely from clinic_ledger_entries/transactions, reusing
 * getLedgerTransactions() (already RLS-scoped, already used by the
 * Ledger page) once per cash/bank/mobile-money account rather than
 * adding any new database object. No table is read or written outside
 * the existing ledger schema, and nothing is ever written.
 *
 * Only entries that actually touch a "cash and cash equivalents" account
 * (clinic_ledger_settings.default_cash_account_id and every account in
 * payment_method_accounts - the exact same definition
 * getLedgerDashboardTotals already uses for its "Cash & Bank" figure)
 * count as a cash movement. Every ledger transaction in this system
 * currently has exactly two legs, so for a transaction with one cash leg
 * the other leg tells us what the cash movement actually was:
 *
 *  - the other leg is Accounts Receivable, Accounts Payable, Inventory,
 *    or any Income/Expense account -> Operating (customer receipts,
 *    supplier/expense payments - all genuinely operating in nature)
 *  - the other leg is the Opening Balance Equity account -> excluded
 *    from all three sections (a balance-forward declaration, not a real
 *    period cash flow) but still included in Net Change so Beginning +
 *    Net Change always equals Ending
 *  - the other leg is any other Asset account -> Investing (this system
 *    has no dedicated Fixed Asset/Equipment account by default; if the
 *    clinic has created one and posted against it, e.g. via a Manual
 *    Journal Entry, it appears here automatically)
 *  - the other leg is any other Liability or Equity account -> Financing
 *    (e.g. a custom Loan Payable account, or the Owner's Equity account)
 *  - both legs are cash accounts (a transfer between Cash and Bank, say)
 *    -> excluded entirely, since it doesn't change the total cash
 *    position across the whole cash pool
 *
 * hasInvestingCapability/hasFinancingCapability reflect whether this
 * clinic's Chart of Accounts contains an account that could ever produce
 * an Investing/Financing line, independent of this period's activity -
 * the UI uses this to distinguish "genuinely zero this period" from
 * "no such account has ever been configured".
 */
export async function getCashFlowStatement(start: Date, end: Date): Promise<CashFlowPeriod> {
  await assertPermission("ledger");

  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const [settings, allAccounts] = await Promise.all([
    getLedgerSettings(),
    getLedgerAccounts({ includeInactive: true }),
  ]);

  const cashAccountIds = new Set<string>(
    [settings.default_cash_account_id, ...Object.values(settings.payment_method_accounts ?? {})].filter(
      (id): id is string => !!id
    )
  );

  const emptySection: CashFlowSection = { lines: [], total: 0 };

  if (cashAccountIds.size === 0) {
    return {
      start: startIso,
      end: endIso,
      beginningCash: 0,
      operating: emptySection,
      investing: emptySection,
      financing: emptySection,
      other: emptySection,
      netChangeInCash: 0,
      endingCash: 0,
      hasInvestingCapability: false,
      hasFinancingCapability: false,
    };
  }

  const receivableId = settings.accounts_receivable_account_id;
  const payableId = settings.accounts_payable_account_id;
  const inventoryId = settings.inventory_account_id;
  const openingBalanceEquityId = settings.opening_balance_equity_account_id;

  const [openingBalanceResults, transactionsByAccount] = await Promise.all([
    Promise.all(
      Array.from(cashAccountIds).map((id) =>
        supabase.rpc("get_account_opening_balance", { p_account_id: id, p_start: startIso })
      )
    ),
    Promise.all(
      Array.from(cashAccountIds).map((id) =>
        getAllLedgerTransactions({ accountId: id, startDate: startIso, endDate: endIso })
      )
    ),
  ]);

  for (const result of openingBalanceResults) {
    if (result.error) {
      logError("[ledger] getCashFlowStatement (opening balance) failed:", result.error);
      throw toError(result.error);
    }
  }

  const beginningCash = openingBalanceResults.reduce((sum, r) => sum + Number(r.data ?? 0), 0);

  type Bucket = "operating" | "investing" | "financing" | "other";

  const linesByBucket: Record<Bucket, Map<string, CashFlowLine>> = {
    operating: new Map(),
    investing: new Map(),
    financing: new Map(),
    other: new Map(),
  };

  const seenTransactionIds = new Set<string>();

  for (const txns of transactionsByAccount) {
    for (const txn of txns) {
      if (seenTransactionIds.has(txn.id)) continue;

      const entries = txn.clinic_ledger_entries ?? [];
      const cashLegs = entries.filter((e) => cashAccountIds.has(e.account_id));
      const nonCashLegs = entries.filter((e) => !cashAccountIds.has(e.account_id));

      // No cash leg (shouldn't happen given the accountId filter), or
      // every leg is a cash account (an internal transfer between two
      // cash accounts - nets to zero across the whole cash pool).
      if (cashLegs.length === 0 || nonCashLegs.length === 0) continue;

      seenTransactionIds.add(txn.id);

      const cashAmount = cashLegs.reduce((sum, e) => sum + (Number(e.debit) - Number(e.credit)), 0);
      if (cashAmount === 0) continue;

      // Every transaction in this system posts exactly two legs today,
      // so with exactly one cash leg there is exactly one other leg.
      const nonCashLeg = nonCashLegs[0];
      const meta = nonCashLeg.clinic_ledger_accounts;
      const accountId = nonCashLeg.account_id;

      let bucket: Bucket;

      if (
        accountId === receivableId ||
        accountId === payableId ||
        accountId === inventoryId ||
        meta?.type === "Income" ||
        meta?.type === "Expense"
      ) {
        bucket = "operating";
      } else if (accountId === openingBalanceEquityId) {
        bucket = "other";
      } else if (meta?.type === "Asset") {
        bucket = "investing";
      } else if (meta?.type === "Liability" || meta?.type === "Equity") {
        bucket = "financing";
      } else {
        bucket = "other";
      }

      const bucketMap = linesByBucket[bucket];
      const existingLine = bucketMap.get(accountId);

      if (existingLine) {
        existingLine.amount += cashAmount;
      } else {
        bucketMap.set(accountId, {
          accountId,
          accountCode: meta?.code ?? "",
          accountName: meta?.name ?? "Unclassified",
          amount: cashAmount,
        });
      }
    }
  }

  function toSection(bucket: Bucket): CashFlowSection {
    const lines = Array.from(linesByBucket[bucket].values()).filter((line) => line.amount !== 0);
    return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) };
  }

  const operating = toSection("operating");
  const investing = toSection("investing");
  const financing = toSection("financing");
  const other = toSection("other");

  const netChangeInCash = operating.total + investing.total + financing.total + other.total;
  const endingCash = beginningCash + netChangeInCash;

  const hasInvestingCapability = allAccounts.some(
    (account) =>
      account.type === "Asset" &&
      !cashAccountIds.has(account.id) &&
      account.id !== receivableId &&
      account.id !== inventoryId
  );

  const hasFinancingCapability = allAccounts.some(
    (account) =>
      (account.type === "Liability" && account.id !== payableId) ||
      (account.type === "Equity" && account.id !== openingBalanceEquityId)
  );

  return {
    start: startIso,
    end: endIso,
    beginningCash,
    operating,
    investing,
    financing,
    other,
    netChangeInCash,
    endingCash,
    hasInvestingCapability,
    hasFinancingCapability,
  };
}

/* -------------------------------------- */
/* Balance Sheet                          */
/* -------------------------------------- */

interface RawBalanceSheetRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: LedgerAccountType;
  total_debit: number;
  total_credit: number;
}

// No subtype/category column exists on clinic_ledger_accounts today, so
// Current vs Non-Current is derived from account identity: the three
// special-purpose accounts (below) plus any account whose name contains
// "Current" (catching the default seed's "Other Current Assets"/"Other
// Current Liabilities") - everything else falls to Non-Current. Same
// name-based-classification precedent already used for EBITDA's
// Depreciation/Amortization detection in getProfitAndLoss().
const CURRENT_NAME_PATTERN = /current/i;

function toBalanceSheetSection(lines: BalanceSheetLine[]): BalanceSheetSection {
  const filtered = lines.filter((line) => line.amount !== 0);
  return { lines: filtered, total: filtered.reduce((sum, line) => sum + line.amount, 0) };
}

/**
 * Balance Sheet as of a single date - built entirely from the
 * double-entry ledger via the single-query get_balance_sheet RPC (one
 * round trip covering every account, no N+1). This is a read-only
 * report: it never writes to any accounting table, and calling it twice
 * concurrently is safe (getLedgerSettings()'s ensureLedgerProvisioned()
 * call is memoized/idempotent, same as every other ledger report).
 *
 * Current vs Non-Current Assets/Liabilities: the three settings-designated
 * accounts (cash/bank/mobile-money, Accounts Receivable, Inventory) are
 * always Current; Accounts Payable is always Current; every other
 * Asset/Liability account is Current only if its name contains "Current"
 * (matching the default chart's "Other Current Assets"/"Other Current
 * Liabilities"), otherwise Non-Current - so a custom "Equipment" or "Loan
 * Payable" account (the same accounts Cash Flow would classify as
 * Investing/Financing) correctly lands in Non-Current here too.
 *
 * Retained Earnings: this system has no dedicated Retained Earnings
 * account and closes no books, so it is calculated - not fabricated - as
 * cumulative Income minus cumulative Expense, all-time up to and
 * including the as-of date. Its `lines` list every contributing
 * Income/Expense account (Expense accounts shown as negative
 * contributions) so the figure is auditable rather than a black box.
 */
export async function getBalanceSheet(asOf: Date): Promise<BalanceSheetPeriod> {
  await assertPermission("ledger");

  const asOfIso = asOf.toISOString().slice(0, 10);

  const clinicId = await getCurrentClinicId();

  const [settings, rpcResult] = await Promise.all([
    getLedgerSettings(),
    supabase.rpc("get_balance_sheet", {
      p_clinic_id: clinicId,
      p_as_of: asOfIso,
    }),
  ]);

  if (rpcResult.error) {
    logError("[ledger] getBalanceSheet failed:", rpcResult.error);
    throw toError(rpcResult.error);
  }

  const rows = (rpcResult.data ?? []) as RawBalanceSheetRow[];

  const cashAccountIds = new Set<string>(
    [settings.default_cash_account_id, ...Object.values(settings.payment_method_accounts ?? {})].filter(
      (id): id is string => !!id
    )
  );
  const receivableId = settings.accounts_receivable_account_id;
  const payableId = settings.accounts_payable_account_id;
  const inventoryId = settings.inventory_account_id;

  const isCurrentAsset = (accountId: string, accountName: string): boolean =>
    cashAccountIds.has(accountId) ||
    accountId === receivableId ||
    accountId === inventoryId ||
    CURRENT_NAME_PATTERN.test(accountName);

  const isCurrentLiability = (accountId: string, accountName: string): boolean =>
    accountId === payableId || CURRENT_NAME_PATTERN.test(accountName);

  const currentAssetLines: BalanceSheetLine[] = [];
  const nonCurrentAssetLines: BalanceSheetLine[] = [];
  const currentLiabilityLines: BalanceSheetLine[] = [];
  const nonCurrentLiabilityLines: BalanceSheetLine[] = [];
  const equityLines: BalanceSheetLine[] = [];
  const retainedEarningsLines: BalanceSheetLine[] = [];

  for (const row of rows) {
    const accountId = row.account_id;
    const accountCode = row.account_code;
    const accountName = row.account_name;
    const totalDebit = Number(row.total_debit);
    const totalCredit = Number(row.total_credit);

    if (row.account_type === "Asset") {
      // Asset accounts are debit-normal.
      const line: BalanceSheetLine = { accountId, accountCode, accountName, amount: totalDebit - totalCredit };
      if (isCurrentAsset(accountId, accountName)) currentAssetLines.push(line);
      else nonCurrentAssetLines.push(line);
    } else if (row.account_type === "Liability") {
      // Liability accounts are credit-normal.
      const line: BalanceSheetLine = { accountId, accountCode, accountName, amount: totalCredit - totalDebit };
      if (isCurrentLiability(accountId, accountName)) currentLiabilityLines.push(line);
      else nonCurrentLiabilityLines.push(line);
    } else if (row.account_type === "Equity") {
      equityLines.push({ accountId, accountCode, accountName, amount: totalCredit - totalDebit });
    } else if (row.account_type === "Income") {
      retainedEarningsLines.push({ accountId, accountCode, accountName, amount: totalCredit - totalDebit });
    } else if (row.account_type === "Expense") {
      retainedEarningsLines.push({ accountId, accountCode, accountName, amount: -(totalDebit - totalCredit) });
    }
  }

  const currentAssets = toBalanceSheetSection(currentAssetLines);
  const nonCurrentAssets = toBalanceSheetSection(nonCurrentAssetLines);
  const totalAssets = currentAssets.total + nonCurrentAssets.total;

  const currentLiabilities = toBalanceSheetSection(currentLiabilityLines);
  const nonCurrentLiabilities = toBalanceSheetSection(nonCurrentLiabilityLines);
  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;

  const equityAccounts = toBalanceSheetSection(equityLines);
  const retainedEarnings = toBalanceSheetSection(retainedEarningsLines);
  const totalEquity = equityAccounts.total + retainedEarnings.total;

  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  // Never forced to zero - a real ledger imbalance (a bug, not float
  // noise) must be visible, not hidden. The 1-cent epsilon only absorbs
  // floating point summation noise, matching getTrialBalance's own rule.
  const difference = totalAssets - totalLiabilitiesAndEquity;

  return {
    asOf: asOfIso,
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    equityAccounts,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    difference,
    balanced: Math.abs(difference) < 0.01,
  };
}

/* -------------------------------------- */
/* EBIT / EBITDA                          */
/* -------------------------------------- */

// Applied only to P&L's own operatingExpenses.lines, in this priority
// order, each excluding accounts already claimed by an earlier pattern -
// same name-based-classification precedent as P&L's own
// DEPRECIATION_NAME_PATTERN (which stays untouched; these are separate,
// finer-grained patterns used only by this report).
const INTEREST_NAME_PATTERN = /interest|finance charge/i;
const TAX_NAME_PATTERN = /\btax\b/i;
const EBIT_DEPRECIATION_PATTERN = /deprecia/i;
const EBIT_AMORTIZATION_PATTERN = /amortiz/i;

/**
 * EBIT/EBITDA for a single period - built entirely on top of
 * getProfitAndLoss() for the same period rather than a second
 * revenue/cost calculation, so Revenue, Direct Costs, and Gross Profit
 * here are always byte-identical to the P&L's own figures for the same
 * dates. This is a read-only report: it calls no RPC beyond what
 * getProfitAndLoss() already calls, and never writes anything.
 *
 * P&L's own Operating Expenses total already includes whatever
 * Interest/Tax/Depreciation/Amortization accounts exist (it doesn't
 * distinguish them - see getProfitAndLoss's own comments). This function
 * re-splits those same lines: Interest and Tax accounts are identified
 * by name and pulled OUT of Operating Expenses entirely (EBIT is
 * defined as being before interest and taxes), while Depreciation and
 * Amortization accounts are identified separately but LEFT IN Operating
 * Expenses (EBIT is after D&A - only EBITDA adds them back on top).
 *
 * When this clinic's Chart of Accounts contains no Interest/Tax account
 * (true for the default seeded chart), no lines are pulled out, so
 * `operatingExpenses.total` and `ebit` below are byte-identical to the
 * P&L's own `totalOperatingExpenses`/`ebit` for the same period - not
 * merely close. EBITDA is only ever populated when Depreciation or
 * Amortization accounts have real activity in the period; otherwise it
 * is null (rendered as "Not available" by the UI, never estimated or
 * silently set equal to EBIT).
 */
/**
 * Pure: given one clinic's already-computed ProfitAndLossPeriod, derives
 * its EbitEbitdaPeriod. Extracted for the same reason as
 * computeProfitAndLossFromRows above - the batched
 * getEbitEbitdaForClinics (CEO Consolidated Financials) and the
 * single-clinic getEbitEbitda share this one computation, so batching
 * the data fetch can never silently change the numbers.
 *
 * FIN-3.10: also exported directly for services/organizations.ts#
 * getOrganizationFinancials, which needs both the P&L map AND its
 * derived EBIT/EBITDA for the same clinics/period - calling this on the
 * P&L it already fetched avoids a second, redundant
 * getProfitAndLossForClinics() round trip (found while auditing that
 * page's query count at 47-branch scale; see that function's own comment).
 */
export function computeEbitEbitdaFromPL(pl: ProfitAndLossPeriod): EbitEbitdaPeriod {
  const interestLines = pl.operatingExpenses.lines.filter((line) =>
    INTEREST_NAME_PATTERN.test(line.accountName)
  );
  const interestIds = new Set(interestLines.map((line) => line.accountId));

  const taxLines = pl.operatingExpenses.lines.filter(
    (line) => !interestIds.has(line.accountId) && TAX_NAME_PATTERN.test(line.accountName)
  );
  const taxIds = new Set(taxLines.map((line) => line.accountId));

  const depreciationLines = pl.operatingExpenses.lines.filter(
    (line) =>
      !interestIds.has(line.accountId) &&
      !taxIds.has(line.accountId) &&
      EBIT_DEPRECIATION_PATTERN.test(line.accountName)
  );
  const depreciationIds = new Set(depreciationLines.map((line) => line.accountId));

  const amortizationLines = pl.operatingExpenses.lines.filter(
    (line) =>
      !interestIds.has(line.accountId) &&
      !taxIds.has(line.accountId) &&
      !depreciationIds.has(line.accountId) &&
      EBIT_AMORTIZATION_PATTERN.test(line.accountName)
  );
  const amortizationIds = new Set(amortizationLines.map((line) => line.accountId));

  const remainingOperatingLines = pl.operatingExpenses.lines.filter(
    (line) =>
      !interestIds.has(line.accountId) &&
      !taxIds.has(line.accountId) &&
      !depreciationIds.has(line.accountId) &&
      !amortizationIds.has(line.accountId)
  );

  // Excludes Interest/Tax, includes Depreciation/Amortization - see the
  // function-level comment above for why.
  const operatingExpenses = buildSection([
    ...remainingOperatingLines,
    ...depreciationLines,
    ...amortizationLines,
  ]);
  const interestExpense = buildSection(interestLines);
  const taxExpense = buildSection(taxLines);
  const depreciation = buildSection(depreciationLines);
  const amortization = buildSection(amortizationLines);

  const revenue = pl.revenue.total;
  const directCosts = pl.directCosts.total;
  const grossProfit = pl.grossProfit;

  const ebit = grossProfit - operatingExpenses.total;

  const ebitdaAvailable = depreciation.total + amortization.total > 0;
  const ebitda = ebitdaAvailable ? ebit + depreciation.total + amortization.total : null;

  const ebitMarginPercent = revenue !== 0 ? (ebit / revenue) * 100 : null;
  const ebitdaMarginPercent =
    ebitdaAvailable && ebitda !== null && revenue !== 0 ? (ebitda / revenue) * 100 : null;

  return {
    start: pl.start,
    end: pl.end,
    revenue,
    directCosts,
    grossProfit,
    operatingExpenses,
    interestExpense,
    taxExpense,
    ebit,
    depreciation,
    amortization,
    ebitdaAvailable,
    ebitda,
    ebitMarginPercent,
    ebitdaMarginPercent,
  };
}

export async function getEbitEbitda(
  start: Date,
  end: Date,
  overrideClinicId?: string
): Promise<EbitEbitdaPeriod> {
  await assertPermission("ledger");

  const pl = await getProfitAndLoss(start, end, overrideClinicId);

  return computeEbitEbitdaFromPL(pl);
}

/**
 * Batched form of getEbitEbitda for every branch of an organization at
 * once - built on getProfitAndLossForClinics (one query round-trip
 * regardless of branch count) instead of calling getEbitEbitda once per
 * branch. This is the piece that was the dominant cost in the CEO
 * Consolidated Financials page at 50-branch scale (~5.4s of a ~10.6s
 * total load) - live-verified before/after in the Production Readiness
 * 2.0 report.
 */
export async function getEbitEbitdaForClinics(
  clinicIds: string[],
  start: Date,
  end: Date
): Promise<Map<string, EbitEbitdaPeriod>> {
  await assertPermission("ledger");

  const plByClinicId = await getProfitAndLossForClinics(clinicIds, start, end);

  const results = new Map<string, EbitEbitdaPeriod>();

  for (const [clinicId, pl] of plByClinicId) {
    results.set(clinicId, computeEbitEbitdaFromPL(pl));
  }

  return results;
}
