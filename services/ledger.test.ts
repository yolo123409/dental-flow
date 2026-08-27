import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FIN-1: unlike most service tests in this codebase, these exercise the
 * REAL getProfitAndLoss()/getLedgerDashboardTotals() implementations
 * (services/ledger.ts) rather than mocking the ledger module wholesale -
 * only the Supabase network boundary is mocked. This is deliberate: the
 * whole point of FIN-1 is that these two functions now share one real
 * accounting calculation, so the test needs to run that calculation, not
 * a stand-in for it.
 *
 * The mocked `get_profit_and_loss` rows below represent the STATE the
 * ledger's own AFTER-INSERT triggers (migration 0043) would have produced
 * for a given scenario - e.g. a Dr Accounts Receivable / Cr Treatment
 * Revenue posting for an invoice. This test does not exercise the actual
 * Postgres triggers themselves (no database credentials are available in
 * this environment - the same disclosed limitation as the FIN-0 audit);
 * it verifies that the TypeScript aggregation layer that reads those rows
 * back out (computeProfitAndLossFromRows, and getLedgerDashboardTotals's
 * use of it) produces the correct Revenue/Direct Costs/Gross Profit/
 * Operating Expenses/Net Profit for a known set of postings.
 */

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

vi.mock("./authorization", () => ({
  assertPermission: vi.fn(),
}));

const CLINIC_ID = "clinic-a";
const AR_ACCOUNT_ID = "acct-ar";
const INVENTORY_ACCOUNT_ID = "acct-inventory";
const AP_ACCOUNT_ID = "acct-ap";
const REVENUE_ACCOUNT_ID = "acct-revenue";
const SUPPLIES_USED_ACCOUNT_ID = "acct-supplies-used";
const OTHER_EXPENSE_ACCOUNT_ID = "acct-other-expense";
const CASH_ACCOUNT_ID = "acct-cash";
const OBE_ACCOUNT_ID = "acct-obe";

interface PlRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
}

let plRows: PlRow[] = [];
let trialBalanceRows: PlRow[] = [];
let reconciliationIssueCount = 0;

function ledgerSettingsRow() {
  return {
    clinic_id: CLINIC_ID,
    treatment_revenue_account_id: REVENUE_ACCOUNT_ID,
    accounts_receivable_account_id: AR_ACCOUNT_ID,
    inventory_account_id: INVENTORY_ACCOUNT_ID,
    accounts_payable_account_id: AP_ACCOUNT_ID,
    supplies_used_account_id: SUPPLIES_USED_ACCOUNT_ID,
    default_expense_account_id: OTHER_EXPENSE_ACCOUNT_ID,
    default_cash_account_id: CASH_ACCOUNT_ID,
    opening_balance_equity_account_id: OBE_ACCOUNT_ID,
    vat_payable_account_id: null,
    payment_method_accounts: {},
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function createMockClient() {
  const rpc = vi.fn((name: string) => {
    switch (name) {
      case "ensure_ledger_provisioned":
      case "ensure_ledger_provisioned_multi":
        return Promise.resolve({ data: null, error: null });
      case "get_profit_and_loss":
        return Promise.resolve({ data: plRows, error: null });
      case "get_trial_balance":
        return Promise.resolve({ data: trialBalanceRows, error: null });
      default:
        return Promise.resolve({ data: null, error: null });
    }
  });

  const from = vi.fn((table: string) => {
    const builder: {
      select: (...args: unknown[]) => typeof builder;
      eq: (...args: unknown[]) => typeof builder;
      order: (...args: unknown[]) => typeof builder;
      single: (...args: unknown[]) => typeof builder;
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown
      ) => unknown;
    } = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      single: () => builder,
      then: (resolve) => {
        if (table === "clinic_ledger_settings") {
          return Promise.resolve({ data: ledgerSettingsRow(), error: null }).then(resolve);
        }

        if (table === "clinic_ledger_reconciliation_issues") {
          return Promise.resolve({
            data: Array.from({ length: reconciliationIssueCount }, (_, i) => ({ id: `issue-${i}` })),
            error: null,
          }).then(resolve);
        }

        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };

    return builder;
  });

  return { rpc, from };
}

let mockClient: ReturnType<typeof createMockClient>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const { getProfitAndLoss, getLedgerDashboardTotals } = await import("./ledger");

const START = new Date("2026-08-01T00:00:00.000Z");
const END = new Date("2026-08-23T23:59:59.999Z");

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  mockClient = createMockClient();
  plRows = [];
  trialBalanceRows = [];
  reconciliationIssueCount = 0;
});

function incomeRow(totalCredit: number) {
  return {
    account_id: REVENUE_ACCOUNT_ID,
    account_code: "4000",
    account_name: "Treatment Revenue",
    account_type: "Income",
    total_debit: 0,
    total_credit: totalCredit,
  };
}

function suppliesUsedRow(totalDebit: number) {
  return {
    account_id: SUPPLIES_USED_ACCOUNT_ID,
    account_code: "5200",
    account_name: "Supplies Used",
    account_type: "Expense",
    total_debit: totalDebit,
    total_credit: 0,
  };
}

function operatingExpenseRow(totalDebit: number) {
  return {
    account_id: OTHER_EXPENSE_ACCOUNT_ID,
    account_code: "5010",
    account_name: "Rent",
    account_type: "Expense",
    total_debit: totalDebit,
    total_credit: 0,
  };
}

describe("getProfitAndLoss - the deterministic KES 25,000 partially-paid invoice scenario", () => {
  it("recognizes the full invoice total as revenue (accrual), even though only part of it has been paid", async () => {
    // Invoice: total 25,000, amount_paid 10,000, balance 15,000. The
    // invoice-creation trigger posts Dr AR 25,000 / Cr Treatment Revenue
    // 25,000 regardless of payment status - the payment itself (Dr Cash
    // 10,000 / Cr AR 10,000) never touches the Income account, so it
    // contributes nothing to this row set.
    plRows = [incomeRow(25000)];

    const pl = await getProfitAndLoss(START, END);

    expect(pl.revenue.total).toBe(25000);
    expect(pl.netProfit).toBe(25000);
  });

  it("does not let a payment posting add additional revenue - Cash/AR movements never appear on the Income account", async () => {
    // Same ledger state as above: a payment only ever posts Dr Cash / Cr
    // Accounts Receivable (migration 0043 section 9). If a payment were
    // ever mistakenly treated as new revenue, this row would need to show
    // total_credit: 35000 (25,000 invoice + 10,000 "extra" revenue) - it
    // does not, because that posting is structurally impossible for a
    // payment to produce.
    plRows = [incomeRow(25000)];

    const pl = await getProfitAndLoss(START, END);

    expect(pl.revenue.total).toBe(25000);
    expect(pl.revenue.total).not.toBe(35000);
  });

  it("computes COGS from the ledger's real Supplies Used account when inventory consumption has been recorded (KES 800), giving Gross Profit of KES 24,200", async () => {
    plRows = [incomeRow(25000), suppliesUsedRow(800)];

    const pl = await getProfitAndLoss(START, END);

    expect(pl.directCosts.total).toBe(800);
    expect(pl.grossProfit).toBe(24200);
    expect(pl.netProfit).toBe(24200);
  });

  it("keeps an unrelated operating expense (e.g. Rent) out of Direct Costs, affecting only Net Profit", async () => {
    plRows = [incomeRow(25000), suppliesUsedRow(800), operatingExpenseRow(2000)];

    const pl = await getProfitAndLoss(START, END);

    expect(pl.directCosts.total).toBe(800);
    expect(pl.grossProfit).toBe(24200);
    expect(pl.totalOperatingExpenses).toBe(2000);
    expect(pl.netProfit).toBe(22200);
  });
});

describe("getLedgerDashboardTotals - Revenue/Expenses/Net Profit now match the Ledger P&L exactly (FIN-1)", () => {
  it("returns the exact same Revenue/Expenses/Net Profit that getProfitAndLoss computes for the same period and rows", async () => {
    plRows = [incomeRow(25000), suppliesUsedRow(800), operatingExpenseRow(2000)];

    const [pl, dashboardTotals] = await Promise.all([
      getProfitAndLoss(START, END),
      getLedgerDashboardTotals(START, END),
    ]);

    expect(dashboardTotals.revenue).toBe(pl.revenue.total);
    expect(dashboardTotals.expenses).toBe(pl.totalOperatingExpenses);
    expect(dashboardTotals.netProfit).toBe(pl.netProfit);

    expect(dashboardTotals.revenue).toBe(25000);
    expect(dashboardTotals.expenses).toBe(2000);
    expect(dashboardTotals.netProfit).toBe(22200);
  });

  it("still computes Cash/AR/AP/Inventory from the trial balance, untouched by the Revenue/Expenses/Net Profit fix", async () => {
    plRows = [incomeRow(25000)];
    trialBalanceRows = [
      { account_id: CASH_ACCOUNT_ID, account_code: "1000", account_name: "Cash", account_type: "Asset", total_debit: 500000, total_credit: 100000 },
      { account_id: AR_ACCOUNT_ID, account_code: "1100", account_name: "Accounts Receivable", account_type: "Asset", total_debit: 25000, total_credit: 10000 },
    ];

    const dashboardTotals = await getLedgerDashboardTotals(START, END);

    expect(dashboardTotals.cashAndBank).toBe(400000);
    expect(dashboardTotals.accountsReceivable).toBe(15000);
  });

  it("supports a null start/end ('All Time' on the Ledger page) without throwing", async () => {
    plRows = [incomeRow(25000)];

    await expect(getLedgerDashboardTotals(null, null)).resolves.toMatchObject({ revenue: 25000 });
  });

  it("reports the count of open ledger reconciliation issues independently of the P&L figures", async () => {
    plRows = [incomeRow(25000)];
    reconciliationIssueCount = 2;

    const dashboardTotals = await getLedgerDashboardTotals(START, END);

    expect(dashboardTotals.openReconciliationIssues).toBe(2);
    expect(dashboardTotals.revenue).toBe(25000);
  });
});
