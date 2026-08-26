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

const { getPaymentLedgerReconciliation } = await import("./paymentReconciliation");

const CLINIC_ID = "clinic-a";

function mockRpcRow(row: {
  total_payments: number;
  posted_payments: number;
  missing_payments: number;
  mismatched_payments: number;
  duplicate_payments: number;
  total_payment_amount: number;
  posted_payment_amount: number;
  missing_payment_amount: number;
}) {
  rpc.mockResolvedValue({ data: [row], error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertPermission.mockResolvedValue(undefined);
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
});

describe("getPaymentLedgerReconciliation", () => {
  it("reports a perfect reconciliation when every payment has exactly one correctly-amounted posting", async () => {
    mockRpcRow({
      total_payments: 9,
      posted_payments: 9,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 154200,
      posted_payment_amount: 154200,
      missing_payment_amount: 0,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result).toEqual({
      totalPayments: 9,
      postedPayments: 9,
      missingPayments: 0,
      mismatchedPayments: 0,
      duplicatePayments: 0,
      totalPaymentAmount: 154200,
      postedPaymentAmount: 154200,
      missingPaymentAmount: 0,
      matches: true,
    });
  });

  it("detects missing payment postings and does not mark it reconciled", async () => {
    // Mirrors this clinic's real, independently-verified Phase O finding:
    // 25 of 34 payments (KES 350,240) have no Payment-type ledger posting.
    mockRpcRow({
      total_payments: 34,
      posted_payments: 9,
      missing_payments: 25,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 504440,
      posted_payment_amount: 154200,
      missing_payment_amount: 350240,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.missingPayments).toBe(25);
    expect(result.missingPaymentAmount).toBe(350240);
    expect(result.matches).toBe(false);
  });

  it("detects a payment amount mismatch and does not mark it reconciled", async () => {
    mockRpcRow({
      total_payments: 5,
      posted_payments: 4,
      missing_payments: 0,
      mismatched_payments: 1,
      duplicate_payments: 0,
      total_payment_amount: 25000,
      posted_payment_amount: 20000,
      missing_payment_amount: 0,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.mismatchedPayments).toBe(1);
    expect(result.matches).toBe(false);
  });

  it("detects a duplicate payment posting and does not mark it reconciled", async () => {
    mockRpcRow({
      total_payments: 5,
      posted_payments: 4,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 1,
      total_payment_amount: 25000,
      posted_payment_amount: 20000,
      missing_payment_amount: 0,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.duplicatePayments).toBe(1);
    expect(result.matches).toBe(false);
  });

  it("reconciles cleanly for a clinic with zero payments", async () => {
    mockRpcRow({
      total_payments: 0,
      posted_payments: 0,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 0,
      posted_payment_amount: 0,
      missing_payment_amount: 0,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result).toEqual({
      totalPayments: 0,
      postedPayments: 0,
      missingPayments: 0,
      mismatchedPayments: 0,
      duplicatePayments: 0,
      totalPaymentAmount: 0,
      postedPaymentAmount: 0,
      missingPaymentAmount: 0,
      matches: true,
    });
  });

  it("correctly aggregates multiple payments recorded against one invoice", async () => {
    // e.g. INV-00007's two payments (30000 + 28000), both missing.
    mockRpcRow({
      total_payments: 2,
      posted_payments: 0,
      missing_payments: 2,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 58000,
      posted_payment_amount: 0,
      missing_payment_amount: 58000,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.totalPayments).toBe(2);
    expect(result.missingPaymentAmount).toBe(58000);
  });

  it("correctly aggregates payments spread across multiple invoices", async () => {
    mockRpcRow({
      total_payments: 10,
      posted_payments: 6,
      missing_payments: 4,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 100000,
      posted_payment_amount: 60000,
      missing_payment_amount: 40000,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.totalPayments).toBe(10);
    expect(result.postedPayments + result.missingPayments).toBe(10);
  });

  it("scopes strictly to the current clinic, passing its id as p_clinic_id and never mixing clinics", async () => {
    getCurrentClinicId.mockResolvedValueOnce("clinic-a");
    mockRpcRow({
      total_payments: 3,
      posted_payments: 3,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 9000,
      posted_payment_amount: 9000,
      missing_payment_amount: 0,
    });

    const resultA = await getPaymentLedgerReconciliation();
    expect(rpc).toHaveBeenLastCalledWith("get_payment_ledger_reconciliation", { p_clinic_id: "clinic-a" });
    expect(resultA.totalPayments).toBe(3);

    getCurrentClinicId.mockResolvedValueOnce("clinic-b");
    mockRpcRow({
      total_payments: 40,
      posted_payments: 40,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 800000,
      posted_payment_amount: 800000,
      missing_payment_amount: 0,
    });

    const resultB = await getPaymentLedgerReconciliation();
    expect(rpc).toHaveBeenLastCalledWith("get_payment_ledger_reconciliation", { p_clinic_id: "clinic-b" });
    expect(resultB.totalPayments).toBe(40);
    expect(resultA.totalPayments).not.toBe(resultB.totalPayments);
  });

  it("reflects an old, historical missing payment posting the same way as a recent one", async () => {
    // The RPC itself doesn't distinguish payment age - this asserts the
    // wrapper doesn't either, e.g. INV-00001's 2026-07-20 payment.
    mockRpcRow({
      total_payments: 1,
      posted_payments: 0,
      missing_payments: 1,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 30000,
      posted_payment_amount: 0,
      missing_payment_amount: 30000,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.missingPayments).toBe(1);
    expect(result.missingPaymentAmount).toBe(30000);
  });

  it("reflects a current/recent correctly-posted payment", async () => {
    mockRpcRow({
      total_payments: 1,
      posted_payments: 1,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 23200,
      posted_payment_amount: 23200,
      missing_payment_amount: 0,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.postedPayments).toBe(1);
    expect(result.matches).toBe(true);
  });

  it("reflects the real post-Phase-P state: Tier 1 backfilled, 4 invoices deliberately left for a future phase", async () => {
    // Phase P backfilled exactly 19 of this clinic's then-missing
    // payments (the "Tier 1" subset - invoices with balance exactly 0
    // and no pre-existing ledger footprint on either side). INV-00007 and
    // INV-00010 (overpaid) and INV-00012/INV-00018 (blocked by the
    // database's own one-posting-per-invoice uniqueness constraint,
    // since Phase N already posted their Invoice-type transaction) were
    // deliberately left unposted - independently confirmed live via SQL
    // immediately after the backfill.
    mockRpcRow({
      total_payments: 36,
      posted_payments: 30,
      missing_payments: 6,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 1618040,
      posted_payment_amount: 1539000,
      missing_payment_amount: 79040,
    });

    const result = await getPaymentLedgerReconciliation();

    expect(result.missingPayments).toBe(6);
    expect(result.missingPaymentAmount).toBe(79040);
    expect(result.matches).toBe(false);
  });

  it("requires ledger permission before returning any figures", async () => {
    mockRpcRow({
      total_payments: 0,
      posted_payments: 0,
      missing_payments: 0,
      mismatched_payments: 0,
      duplicate_payments: 0,
      total_payment_amount: 0,
      posted_payment_amount: 0,
      missing_payment_amount: 0,
    });

    await getPaymentLedgerReconciliation();

    expect(assertPermission).toHaveBeenCalledWith("ledger");
  });

  it("throws a safe error and never returns a partial figure when the RPC call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(getPaymentLedgerReconciliation()).rejects.toThrow();
  });
});
