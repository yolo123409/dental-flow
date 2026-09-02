import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: (...args: unknown[]) => getCurrentClinicId(...args),
}));

const getArReconciliationStatus = vi.fn();
vi.mock("./accountsReceivable", () => ({
  getArReconciliationStatus: (...args: unknown[]) => getArReconciliationStatus(...args),
}));

const getPaymentLedgerReconciliation = vi.fn();
vi.mock("./paymentReconciliation", () => ({
  getPaymentLedgerReconciliation: (...args: unknown[]) => getPaymentLedgerReconciliation(...args),
}));

const getLedgerSettings = vi.fn();
vi.mock("./ledger", () => ({
  getLedgerSettings: (...args: unknown[]) => getLedgerSettings(...args),
}));

const { getAccountingHealthReport } = await import("./accountingHealth");

// The real, live clinic KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS is scoped to
// (full-app audit fix H11) - using the real id here means the existing
// "known exception" tests below continue to exercise the actual fix
// rather than coincidentally passing against an arbitrary placeholder.
const CLINIC_ID = "ed2d8fb6-3603-47bd-ac8e-061a324a489d";

function makeArStatus(overrides: Record<string, unknown> = {}) {
  return {
    ledgerBalance: 776720,
    invoiceOutstandingBalance: 776720,
    difference: 0,
    matches: true,
    ...overrides,
  };
}

function makePaymentReconciliation(overrides: Record<string, unknown> = {}) {
  return {
    totalPayments: 36,
    postedPayments: 30,
    missingPayments: 6,
    mismatchedPayments: 0,
    duplicatePayments: 0,
    totalPaymentAmount: 1618040,
    postedPaymentAmount: 1539000,
    missingPaymentAmount: 79040,
    matches: false,
    ...overrides,
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    clinic_id: CLINIC_ID,
    treatment_revenue_account_id: "rev",
    accounts_receivable_account_id: "ar",
    inventory_account_id: null,
    accounts_payable_account_id: null,
    supplies_used_account_id: null,
    default_expense_account_id: null,
    default_cash_account_id: "cash-1",
    opening_balance_equity_account_id: null,
    vat_payable_account_id: null,
    payment_method_accounts: { Cash: "cash-1" },
    updated_at: "2026-01-01",
    ...overrides,
  };
}

// Exactly the live, dynamically-discovered Tier P exceptions: INV-00007
// and INV-00010 each have two missing payments summing to their known
// total, INV-00012/INV-00018 each have one.
function knownExceptionRows() {
  return [
    { payment_id: "p1", invoice_id: "i7", invoice_number: "INV-00007", patient_id: "pt1", payment_amount: 30000, posting_count: 0, posted_credit: 0, exception_type: "missing" },
    { payment_id: "p2", invoice_id: "i7", invoice_number: "INV-00007", patient_id: "pt1", payment_amount: 28000, posting_count: 0, posted_credit: 0, exception_type: "missing" },
    { payment_id: "p3", invoice_id: "i10", invoice_number: "INV-00010", patient_id: "pt2", payment_amount: 6000, posting_count: 0, posted_credit: 0, exception_type: "missing" },
    { payment_id: "p4", invoice_id: "i10", invoice_number: "INV-00010", patient_id: "pt2", payment_amount: 5000, posting_count: 0, posted_credit: 0, exception_type: "missing" },
    { payment_id: "p5", invoice_id: "i12", invoice_number: "INV-00012", patient_id: "pt3", payment_amount: 40, posting_count: 0, posted_credit: 0, exception_type: "missing" },
    { payment_id: "p6", invoice_id: "i18", invoice_number: "INV-00018", patient_id: "pt4", payment_amount: 10000, posting_count: 0, posted_credit: 0, exception_type: "missing" },
  ];
}

const ZERO_INTEGRITY_ROW = [
  {
    total_transactions: 70,
    transactions_without_entries: 0,
    unbalanced_transactions: 0,
    unbalanced_amount: 0,
    duplicate_reference_groups: 0,
    duplicate_reference_transactions: 0,
  },
];

function mockRpc(handlers: Record<string, unknown>) {
  // get_expense_ledger_exceptions defaults to empty for every test that
  // doesn't care about expense reconciliation - only the dedicated tests
  // below override it.
  const withDefaults: Record<string, unknown> = { get_expense_ledger_exceptions: [], ...handlers };
  rpc.mockImplementation((fn: string) => {
    if (fn in withDefaults) return Promise.resolve({ data: withDefaults[fn], error: null });
    return Promise.reject(new Error(`Unexpected rpc call in test: ${fn}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertPermission.mockResolvedValue(undefined);
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  getLedgerSettings.mockResolvedValue(makeSettings());
});

describe("getAccountingHealthReport", () => {
  it("1. reports a fully healthy overall status for a completely clean clinic", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(
      makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true, totalPayments: 30, postedPayments: 30 })
    );
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.overallStatus).toBe("healthy");
    for (const check of Object.values(report.checks)) {
      expect(check.status).toBe("healthy");
    }
    expect(report.summary).toEqual({ healthyChecks: 8, warningChecks: 0, criticalChecks: 0 });
  });

  it("2. classifies exactly-known historical payment exceptions as warning, never critical", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation());
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: knownExceptionRows(),
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.status).toBe("warning");
    expect(report.checks.paymentReconciliation.newExceptions).toEqual([]);
    expect(report.checks.paymentReconciliation.knownExceptions).toHaveLength(6);
    expect(report.checks.historicalExceptions.status).toBe("warning");
    expect(report.checks.historicalExceptions.entries.every((e) => e.currentlyPresent)).toBe(true);
    expect(report.checks.cashFlowReconciliation.status).toBe("warning");
    expect(report.checks.cashFlowReconciliation.unexplainedGapAmount).toBe(0);
    expect(report.checks.cashFlowReconciliation.knownGapAmount).toBe(79040);
    expect(report.overallStatus).toBe("warning");
  });

  it("2b. full-app audit fix H11: the SAME exception rows on a DIFFERENT clinic are never absorbed into the known-exceptions allowlist - invoice numbers restart per clinic, so matching by number alone would let an unrelated clinic's genuinely new failure hide behind this clinic's resolved history", async () => {
    getCurrentClinicId.mockResolvedValueOnce("some-other-clinic-with-its-own-invoice-numbered-INV-00007");
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation());
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: knownExceptionRows(),
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.status).toBe("critical");
    expect(report.checks.paymentReconciliation.knownExceptions).toEqual([]);
    expect(report.checks.paymentReconciliation.newExceptions).toHaveLength(6);
    expect(report.checks.historicalExceptions.entries).toEqual([]);
    expect(report.overallStatus).toBe("critical");
  });

  it("3. classifies a new missing payment (unknown invoice) as a critical discrepancy", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(
      makePaymentReconciliation({ missingPayments: 1, missingPaymentAmount: 5000, totalPayments: 40, postedPayments: 39 })
    );
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [
        {
          payment_id: "pX",
          invoice_id: "iX",
          invoice_number: "INV-00099",
          patient_id: "ptX",
          payment_amount: 5000,
          posting_count: 0,
          posted_credit: 0,
          exception_type: "missing",
        },
      ],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.status).toBe("critical");
    expect(report.checks.paymentReconciliation.newExceptions).toHaveLength(1);
    expect(report.checks.paymentReconciliation.newExceptions[0].invoiceNumber).toBe("INV-00099");
    expect(report.checks.cashFlowReconciliation.status).toBe("critical");
    expect(report.overallStatus).toBe("critical");
  });

  it("4. treats a mismatched-amount posting on a KNOWN invoice number as a new discrepancy, not a known exception", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ mismatchedPayments: 1 }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [
        {
          payment_id: "p1",
          invoice_id: "i7",
          invoice_number: "INV-00007",
          patient_id: "pt1",
          payment_amount: 58000,
          posting_count: 1,
          posted_credit: 40000,
          exception_type: "mismatched",
        },
      ],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.newExceptions).toHaveLength(1);
    expect(report.checks.paymentReconciliation.knownExceptions).toEqual([]);
    expect(report.checks.paymentReconciliation.status).toBe("critical");
  });

  it("5. treats a duplicate posting as a new discrepancy", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ duplicatePayments: 1 }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [
        {
          payment_id: "pD",
          invoice_id: "iD",
          invoice_number: "INV-00050",
          patient_id: "ptD",
          payment_amount: 2000,
          posting_count: 2,
          posted_credit: 4000,
          exception_type: "duplicate",
        },
      ],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.newExceptions).toHaveLength(1);
    expect(report.checks.paymentReconciliation.status).toBe("critical");
    expect(report.overallStatus).toBe("critical");
  });

  it("6. classifies AR mismatches by magnitude - small difference is a warning, large difference is critical", async () => {
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    getArReconciliationStatus.mockResolvedValueOnce(
      makeArStatus({ ledgerBalance: 100000, invoiceOutstandingBalance: 99500, difference: 500, matches: false })
    );
    const small = await getAccountingHealthReport();
    expect(small.checks.arReconciliation.status).toBe("warning");
    expect(small.overallStatus).toBe("warning");

    getArReconciliationStatus.mockResolvedValueOnce(
      makeArStatus({ ledgerBalance: 100000, invoiceOutstandingBalance: 50000, difference: 50000, matches: false })
    );
    const large = await getAccountingHealthReport();
    expect(large.checks.arReconciliation.status).toBe("critical");
    expect(large.overallStatus).toBe("critical");
  });

  it("7. detects overpaid invoices and excludes them from the invoice-consistency issue list", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [
        {
          invoice_id: "i7",
          invoice_number: "INV-00007",
          patient_id: "pt1",
          patient_name: "Jane Doe",
          total: 57996.52,
          amount_paid: 58000,
          balance: -3.48,
          status: "Paid",
          issue: "amount_paid exceeds invoice total",
        },
      ],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.overpayments.overpayments).toHaveLength(1);
    expect(report.checks.overpayments.overpayments[0].amountOverpaid).toBeCloseTo(3.48, 2);
    expect(report.checks.overpayments.overpayments[0].isKnownException).toBe(true);
    expect(report.checks.overpayments.status).toBe("warning");
    expect(report.checks.invoiceConsistency.issues).toHaveLength(0);
    expect(report.checks.invoiceConsistency.status).toBe("healthy");
  });

  it("8. classifies a stale-status zero-balance invoice as warning, not critical (zero monetary impact)", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [
        {
          invoice_id: "i30",
          invoice_number: "INV-00030",
          patient_id: "ptX",
          patient_name: "—",
          total: 0,
          amount_paid: 0,
          balance: 0,
          status: "Unpaid",
          issue: "status is Unpaid but balance is zero",
        },
      ],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.invoiceConsistency.status).toBe("warning");
    expect(report.checks.invoiceConsistency.issues).toHaveLength(1);
    expect(report.checks.overpayments.overpayments).toHaveLength(0);
    expect(report.overallStatus).toBe("warning");
  });

  it("9. flags an unbalanced ledger transaction as critical", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: [
        {
          total_transactions: 10,
          transactions_without_entries: 0,
          unbalanced_transactions: 1,
          unbalanced_amount: 50,
          duplicate_reference_groups: 0,
          duplicate_reference_transactions: 0,
        },
      ],
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.ledgerIntegrity.status).toBe("critical");
    expect(report.checks.ledgerIntegrity.unbalancedTransactions).toBe(1);
    expect(report.overallStatus).toBe("critical");
  });

  it("10. combines multiple simultaneous warnings into an overall warning, not critical", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation());
    mockRpc({
      get_invoice_consistency_exceptions: [
        {
          invoice_id: "i30",
          invoice_number: "INV-00030",
          patient_id: "ptX",
          patient_name: "—",
          total: 0,
          amount_paid: 0,
          balance: 0,
          status: "Unpaid",
          issue: "status is Unpaid but balance is zero",
        },
      ],
      get_payment_ledger_exceptions: knownExceptionRows(),
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.status).toBe("warning");
    expect(report.checks.historicalExceptions.status).toBe("warning");
    expect(report.checks.invoiceConsistency.status).toBe("warning");
    expect(report.summary.criticalChecks).toBe(0);
    expect(report.summary.warningChecks).toBeGreaterThanOrEqual(3);
    expect(report.overallStatus).toBe("warning");
  });

  it("11. lets a single critical check override every simultaneous warning in the overall status", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation());
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: knownExceptionRows(),
      get_ledger_integrity_summary: [
        {
          total_transactions: 10,
          transactions_without_entries: 0,
          unbalanced_transactions: 1,
          unbalanced_amount: 50,
          duplicate_reference_groups: 0,
          duplicate_reference_transactions: 0,
        },
      ],
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.status).toBe("warning");
    expect(report.checks.ledgerIntegrity.status).toBe("critical");
    expect(report.summary.warningChecks).toBeGreaterThanOrEqual(1);
    expect(report.summary.criticalChecks).toBeGreaterThanOrEqual(1);
    expect(report.overallStatus).toBe("critical");
  });

  it("12. scopes every new RPC call to the current clinic and never mixes clinics", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    getCurrentClinicId.mockResolvedValueOnce("clinic-a");
    await getAccountingHealthReport();
    expect(rpc).toHaveBeenCalledWith("get_invoice_consistency_exceptions", { p_clinic_id: "clinic-a" });
    expect(rpc).toHaveBeenCalledWith("get_payment_ledger_exceptions", { p_clinic_id: "clinic-a" });
    expect(rpc).toHaveBeenCalledWith("get_ledger_integrity_summary", { p_clinic_id: "clinic-a" });
    expect(rpc).toHaveBeenCalledWith("get_expense_ledger_exceptions", { p_clinic_id: "clinic-a" });

    getCurrentClinicId.mockResolvedValueOnce("clinic-b");
    await getAccountingHealthReport();
    expect(rpc).toHaveBeenCalledWith("get_invoice_consistency_exceptions", { p_clinic_id: "clinic-b" });
    expect(rpc).toHaveBeenCalledWith("get_payment_ledger_exceptions", { p_clinic_id: "clinic-b" });
    expect(rpc).toHaveBeenCalledWith("get_ledger_integrity_summary", { p_clinic_id: "clinic-b" });
    expect(rpc).toHaveBeenCalledWith("get_expense_ledger_exceptions", { p_clinic_id: "clinic-b" });
  });

  it("13. reports healthy invoice checks for a clinic with no invoices at all", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus({ ledgerBalance: 0, invoiceOutstandingBalance: 0, difference: 0 }));
    getPaymentLedgerReconciliation.mockResolvedValue(
      makePaymentReconciliation({ totalPayments: 0, postedPayments: 0, missingPayments: 0, missingPaymentAmount: 0, totalPaymentAmount: 0, matches: true })
    );
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.invoiceConsistency.status).toBe("healthy");
    expect(report.checks.overpayments.status).toBe("healthy");
    expect(report.checks.overpayments.overpayments).toEqual([]);
  });

  it("14. reports healthy payment reconciliation for a clinic with no payments at all", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(
      makePaymentReconciliation({ totalPayments: 0, postedPayments: 0, missingPayments: 0, missingPaymentAmount: 0, totalPaymentAmount: 0, matches: true })
    );
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.status).toBe("healthy");
    expect(report.checks.paymentReconciliation.totalPayments).toBe(0);
    expect(report.checks.cashFlowReconciliation.status).toBe("healthy");
  });

  it("15. reports healthy ledger integrity for a clinic with an entirely empty ledger", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus({ ledgerBalance: 0, invoiceOutstandingBalance: 0, difference: 0 }));
    getPaymentLedgerReconciliation.mockResolvedValue(
      makePaymentReconciliation({ totalPayments: 0, postedPayments: 0, missingPayments: 0, missingPaymentAmount: 0, totalPaymentAmount: 0, matches: true })
    );
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: [
        {
          total_transactions: 0,
          transactions_without_entries: 0,
          unbalanced_transactions: 0,
          unbalanced_amount: 0,
          duplicate_reference_groups: 0,
          duplicate_reference_transactions: 0,
        },
      ],
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.ledgerIntegrity.status).toBe("healthy");
    expect(report.checks.ledgerIntegrity.totalTransactions).toBe(0);
    expect(report.overallStatus).toBe("healthy");
  });

  it("16. classifies known-exception matching precisely: exact match is known, a drifted amount on the same invoice is entirely new", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation());

    // INV-00012's known amount is exactly 40 - a live exception of 999
    // for the same invoice number must NOT be silently absorbed into the
    // known bucket just because the invoice number matches.
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [
        {
          payment_id: "pDrift",
          invoice_id: "i12",
          invoice_number: "INV-00012",
          patient_id: "pt3",
          payment_amount: 999,
          posting_count: 0,
          posted_credit: 0,
          exception_type: "missing",
        },
      ],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.paymentReconciliation.knownExceptions).toEqual([]);
    expect(report.checks.paymentReconciliation.newExceptions).toHaveLength(1);
    expect(report.checks.paymentReconciliation.status).toBe("critical");

    const inv12Entry = report.checks.historicalExceptions.entries.find((e) => e.invoiceNumber === "INV-00012");
    expect(inv12Entry?.currentlyPresent).toBe(false);
    expect(inv12Entry?.currentAmount).toBe(999);
  });

  it("17. reports healthy expense reconciliation when every paid expense has exactly one correctly-amounted posting", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
      get_expense_ledger_exceptions: [],
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.expenseReconciliation.status).toBe("healthy");
    expect(report.checks.expenseReconciliation.exceptions).toEqual([]);
  });

  it("18. classifies any expense ledger exception as critical - there is no known historical bucket for expenses", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
      get_expense_ledger_exceptions: [
        {
          expense_id: "e1",
          description: "Dental supplies restock",
          expense_amount: 15000,
          status: "Paid",
          posting_count: 0,
          posted_debit: 0,
          exception_type: "missing",
        },
      ],
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.expenseReconciliation.status).toBe("critical");
    expect(report.checks.expenseReconciliation.exceptions).toHaveLength(1);
    expect(report.checks.expenseReconciliation.totalExceptionAmount).toBe(15000);
    expect(report.overallStatus).toBe("critical");
  });

  it("requires ledger permission before returning any figures", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    await getAccountingHealthReport();

    expect(assertPermission).toHaveBeenCalledWith("ledger");
  });

  it("treats a clinic with no cash/bank account configured as a Cash Flow warning", async () => {
    getArReconciliationStatus.mockResolvedValue(makeArStatus());
    getPaymentLedgerReconciliation.mockResolvedValue(makePaymentReconciliation({ missingPayments: 0, missingPaymentAmount: 0, matches: true }));
    getLedgerSettings.mockResolvedValue(makeSettings({ default_cash_account_id: null, payment_method_accounts: {} }));
    mockRpc({
      get_invoice_consistency_exceptions: [],
      get_payment_ledger_exceptions: [],
      get_ledger_integrity_summary: ZERO_INTEGRITY_ROW,
    });

    const report = await getAccountingHealthReport();

    expect(report.checks.cashFlowReconciliation.status).toBe("warning");
    expect(report.checks.cashFlowReconciliation.cashAccountsConfigured).toBe(false);
  });
});
