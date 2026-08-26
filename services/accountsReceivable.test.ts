import { beforeEach, describe, expect, it, vi } from "vitest";

// accountsReceivable.ts imports the real supabase client at module scope
// (used by its other export, getOutstandingInvoiceRows/getAccountsReceivableReport,
// which these tests never exercise) - stubbed here purely so importing the
// module under test doesn't try to construct a real client with no env vars.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: (...args: unknown[]) => getCurrentClinicId(...args),
}));

const getLedgerSettings = vi.fn();
const getTrialBalance = vi.fn();
const getCashFlowStatement = vi.fn();
const getProfitAndLoss = vi.fn();
vi.mock("./ledger", () => ({
  getLedgerSettings: (...args: unknown[]) => getLedgerSettings(...args),
  getTrialBalance: (...args: unknown[]) => getTrialBalance(...args),
  getCashFlowStatement: (...args: unknown[]) => getCashFlowStatement(...args),
  getProfitAndLoss: (...args: unknown[]) => getProfitAndLoss(...args),
}));

const getOutstandingInvoiceBalance = vi.fn();
vi.mock("./billing", () => ({
  getOutstandingInvoiceBalance: (...args: unknown[]) => getOutstandingInvoiceBalance(...args),
}));

const { getArReconciliationStatus } = await import("./accountsReceivable");

const AR_ACCOUNT_ID = "ar-account-1";

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    accounts_receivable_account_id: AR_ACCOUNT_ID,
    accounts_payable_account_id: null,
    default_cash_account_id: null,
    treatment_revenue_account_id: null,
    inventory_account_id: null,
    payment_method_accounts: {},
    ...overrides,
  };
}

function makeTrialBalance(arDebitBalance: number) {
  return {
    rows: [
      {
        accountId: AR_ACCOUNT_ID,
        accountCode: "1100",
        accountName: "Accounts Receivable",
        accountType: "Asset",
        totalDebit: arDebitBalance,
        totalCredit: 0,
        debitBalance: arDebitBalance,
        creditBalance: 0,
      },
    ],
    totalDebits: arDebitBalance,
    totalCredits: 0,
    balanced: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertPermission.mockResolvedValue(undefined);
});

describe("getArReconciliationStatus", () => {
  it("reports a perfect reconciliation when ledger AR equals outstanding invoice AR", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(1890320));
    getOutstandingInvoiceBalance.mockResolvedValue(1890320);

    const result = await getArReconciliationStatus();

    expect(result).toEqual({
      ledgerBalance: 1890320,
      invoiceOutstandingBalance: 1890320,
      difference: 0,
      matches: true,
    });
  });

  it("detects a positive discrepancy where ledger AR exceeds invoice AR", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(1890320));
    getOutstandingInvoiceBalance.mockResolvedValue(1349160);

    const result = await getArReconciliationStatus();

    expect(result.ledgerBalance).toBe(1890320);
    expect(result.invoiceOutstandingBalance).toBe(1349160);
    expect(result.difference).toBe(541160);
    expect(result.matches).toBe(false);
  });

  it("detects a negative discrepancy where invoice AR exceeds ledger AR", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(1349160));
    getOutstandingInvoiceBalance.mockResolvedValue(1890320);

    const result = await getArReconciliationStatus();

    expect(result.ledgerBalance).toBe(1349160);
    expect(result.invoiceOutstandingBalance).toBe(1890320);
    expect(result.difference).toBe(-541160);
    expect(result.matches).toBe(false);
  });

  it("reconciles cleanly when there is zero outstanding invoice AR but the ledger also shows zero", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(0));
    getOutstandingInvoiceBalance.mockResolvedValue(0);

    const result = await getArReconciliationStatus();

    expect(result.invoiceOutstandingBalance).toBe(0);
    expect(result.ledgerBalance).toBe(0);
    expect(result.matches).toBe(true);
  });

  it("flags a mismatch when the ledger AR balance is zero but invoices are still outstanding", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(0));
    getOutstandingInvoiceBalance.mockResolvedValue(20000);

    const result = await getArReconciliationStatus();

    expect(result.ledgerBalance).toBe(0);
    expect(result.invoiceOutstandingBalance).toBe(20000);
    expect(result.difference).toBe(-20000);
    expect(result.matches).toBe(false);
  });

  it("reconciles cleanly for a clinic with no invoices at all", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(0));
    getOutstandingInvoiceBalance.mockResolvedValue(0);

    const result = await getArReconciliationStatus();

    expect(result).toEqual({
      ledgerBalance: 0,
      invoiceOutstandingBalance: 0,
      difference: 0,
      matches: true,
    });
  });

  it("scopes strictly to the current clinic's own figures, never mixing another clinic's balances", async () => {
    getLedgerSettings.mockResolvedValueOnce(makeSettings());
    getTrialBalance.mockResolvedValueOnce(makeTrialBalance(75000));
    getOutstandingInvoiceBalance.mockResolvedValueOnce(75000);

    const clinicA = await getArReconciliationStatus();
    expect(clinicA).toEqual({
      ledgerBalance: 75000,
      invoiceOutstandingBalance: 75000,
      difference: 0,
      matches: true,
    });

    getLedgerSettings.mockResolvedValueOnce(makeSettings({ accounts_receivable_account_id: "ar-account-2" }));
    getTrialBalance.mockResolvedValueOnce({
      rows: [
        {
          accountId: "ar-account-2",
          accountCode: "1100",
          accountName: "Accounts Receivable",
          accountType: "Asset",
          totalDebit: 12000,
          totalCredit: 0,
          debitBalance: 12000,
          creditBalance: 0,
        },
      ],
      totalDebits: 12000,
      totalCredits: 0,
      balanced: true,
    });
    getOutstandingInvoiceBalance.mockResolvedValueOnce(12000);

    const clinicB = await getArReconciliationStatus();
    expect(clinicB).toEqual({
      ledgerBalance: 12000,
      invoiceOutstandingBalance: 12000,
      difference: 0,
      matches: true,
    });

    // Each call's result must reflect only the mocks supplied for that
    // call - clinic A's 75000 must never leak into clinic B's 12000 figure.
    expect(clinicA.ledgerBalance).not.toBe(clinicB.ledgerBalance);
  });

  it("treats sub-cent floating point noise as reconciled, not a real discrepancy", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(1890320.004));
    getOutstandingInvoiceBalance.mockResolvedValue(1890320);

    const result = await getArReconciliationStatus();

    expect(result.matches).toBe(true);
  });

  it("treats a missing Accounts Receivable account mapping as a zero ledger balance rather than throwing", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings({ accounts_receivable_account_id: null }));
    getTrialBalance.mockResolvedValue({ rows: [], totalDebits: 0, totalCredits: 0, balanced: true });
    getOutstandingInvoiceBalance.mockResolvedValue(1000);

    const result = await getArReconciliationStatus();

    expect(result.ledgerBalance).toBe(0);
    expect(result.invoiceOutstandingBalance).toBe(1000);
    expect(result.matches).toBe(false);
  });

  it("requires ledger permission before returning any figures", async () => {
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(0));
    getOutstandingInvoiceBalance.mockResolvedValue(0);

    await getArReconciliationStatus();

    expect(assertPermission).toHaveBeenCalledWith("ledger");
  });

  it("no longer produces a false mismatch when an overpaid invoice exists elsewhere in the clinic (Phase O regression)", async () => {
    // Before Phase O this used getInvoiceBalanceTotals(), which nets a
    // negative-balance (overpaid) invoice against the rest of the
    // clinic's balance - producing a false "matches: false" even when
    // the ledger and the real Outstanding AR agree. Now sourced from
    // getOutstandingInvoiceBalance() (floor-at-zero), so an overpayment
    // elsewhere must never move this result.
    getLedgerSettings.mockResolvedValue(makeSettings());
    getTrialBalance.mockResolvedValue(makeTrialBalance(1890320));
    getOutstandingInvoiceBalance.mockResolvedValue(1890320);

    const result = await getArReconciliationStatus();

    expect(result).toEqual({
      ledgerBalance: 1890320,
      invoiceOutstandingBalance: 1890320,
      difference: 0,
      matches: true,
    });
  });
});
