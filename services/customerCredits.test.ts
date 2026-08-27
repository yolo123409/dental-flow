import { beforeEach, describe, expect, it, vi } from "vitest";

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

type Call = { method: string; args: unknown[] };

function createSupabaseMock(
  rpcHandler: (fn: string, args: unknown) => { data: unknown; error: unknown },
  selectHandler: (info: { calls: Call[] }) => { data: unknown; error: unknown } = () => ({
    data: [],
    error: null,
  })
) {
  return {
    from() {
      const calls: Call[] = [];
      const builder: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          calls.push({ method: "select", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          calls.push({ method: "eq", args });
          return builder;
        },
        order: (...args: unknown[]) => {
          calls.push({ method: "order", args });
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(selectHandler({ calls })).then(resolve),
      };
      return builder;
    },
    rpc: (fn: string, args: unknown) => Promise.resolve(rpcHandler(fn, args)),
  };
}

let mockClient: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const { grantCustomerCredit, applyCustomerCredit, refundCustomerCredit, getPatientCredits } =
  await import("./customerCredits");

const CREDIT_ROW = {
  id: "credit-1",
  clinic_id: "clinic-1",
  patient_id: "patient-1",
  source_invoice_id: "inv-1",
  amount: 200,
  remaining_amount: 200,
  notes: null,
  created_at: "2026-08-27",
  created_by: "user-1",
  updated_at: "2026-08-27",
};

beforeEach(() => {
  vi.clearAllMocks();
  assertPermission.mockResolvedValue(undefined);
  mockClient = createSupabaseMock(() => ({ data: CREDIT_ROW, error: null }));
});

describe("grantCustomerCredit", () => {
  it("checks billing permission before calling the RPC", async () => {
    await grantCustomerCredit("inv-1");
    expect(assertPermission).toHaveBeenCalledWith("billing");
  });

  it("passes the invoice id, amount, and notes through to grant_customer_credit", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: CREDIT_ROW, error: null }));
    mockClient = { ...mockClient, rpc };

    await grantCustomerCredit("inv-1", 150, "partial credit");

    expect(rpc).toHaveBeenCalledWith("grant_customer_credit", {
      p_invoice_id: "inv-1",
      p_amount: 150,
      p_notes: "partial credit",
    });
  });

  it("defaults amount and notes to null when omitted, letting the RPC credit the full overpayment", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: CREDIT_ROW, error: null }));
    mockClient = { ...mockClient, rpc };

    await grantCustomerCredit("inv-1");

    expect(rpc).toHaveBeenCalledWith("grant_customer_credit", {
      p_invoice_id: "inv-1",
      p_amount: null,
      p_notes: null,
    });
  });

  it("surfaces the RPC's own error (e.g. role rejection, not-overpaid, already-granted) rather than swallowing it", async () => {
    mockClient = createSupabaseMock(() => ({
      data: null,
      error: { message: "Your role (Dentist) is not authorized to grant a customer credit." },
    }));

    await expect(grantCustomerCredit("inv-1")).rejects.toThrow(/not authorized/i);
  });
});

describe("applyCustomerCredit", () => {
  it("rejects a non-positive amount before ever calling the RPC", async () => {
    const rpc = vi.fn();
    mockClient = { ...mockClient, rpc };

    await expect(applyCustomerCredit("credit-1", "inv-2", 0)).rejects.toThrow(/greater than zero/i);
    await expect(applyCustomerCredit("credit-1", "inv-2", -5)).rejects.toThrow(/greater than zero/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes credit id, invoice id, and amount through to apply_customer_credit", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: { id: "inv-2", balance: 0 }, error: null }));
    mockClient = { ...mockClient, rpc };

    await applyCustomerCredit("credit-1", "inv-2", 150);

    expect(rpc).toHaveBeenCalledWith("apply_customer_credit", {
      p_credit_id: "credit-1",
      p_invoice_id: "inv-2",
      p_amount: 150,
    });
  });
});

describe("refundCustomerCredit", () => {
  it("rejects a non-positive amount before ever calling the RPC", async () => {
    const rpc = vi.fn();
    mockClient = { ...mockClient, rpc };

    await expect(refundCustomerCredit("credit-1", 0, "Cash")).rejects.toThrow(/greater than zero/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes every field through to refund_customer_credit, defaulting reference/notes to null", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: CREDIT_ROW, error: null }));
    mockClient = { ...mockClient, rpc };

    await refundCustomerCredit("credit-1", 50, "Cash");

    expect(rpc).toHaveBeenCalledWith("refund_customer_credit", {
      p_credit_id: "credit-1",
      p_amount: 50,
      p_payment_method: "Cash",
      p_reference: null,
      p_notes: null,
    });
  });

  it("passes reference and notes through when provided", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: CREDIT_ROW, error: null }));
    mockClient = { ...mockClient, rpc };

    await refundCustomerCredit("credit-1", 50, "M-Pesa", "REF123", "handed back at front desk");

    expect(rpc).toHaveBeenCalledWith("refund_customer_credit", {
      p_credit_id: "credit-1",
      p_amount: 50,
      p_payment_method: "M-Pesa",
      p_reference: "REF123",
      p_notes: "handed back at front desk",
    });
  });
});

describe("getPatientCredits", () => {
  it("checks billing permission and returns every credit for the patient, newest first", async () => {
    mockClient = createSupabaseMock(
      () => ({ data: null, error: null }),
      () => ({ data: [CREDIT_ROW], error: null })
    );

    const result = await getPatientCredits("patient-1");

    expect(assertPermission).toHaveBeenCalledWith("billing");
    expect(result).toEqual([CREDIT_ROW]);
  });

  it("returns an empty array for a patient with no credits, never null", async () => {
    mockClient = createSupabaseMock(
      () => ({ data: null, error: null }),
      () => ({ data: null, error: null })
    );

    const result = await getPatientCredits("patient-1");

    expect(result).toEqual([]);
  });
});
