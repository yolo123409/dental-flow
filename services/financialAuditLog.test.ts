import { beforeEach, describe, expect, it, vi } from "vitest";

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

let queryResult: { data: unknown; error: unknown } = { data: [], error: null };
let lastCalls: { method: string; args: unknown[] }[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      lastCalls = [{ method: "from", args: [table] }];

      const builder = {
        select: (...args: unknown[]) => {
          lastCalls.push({ method: "select", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          lastCalls.push({ method: "eq", args });
          return builder;
        },
        order: (...args: unknown[]) => {
          lastCalls.push({ method: "order", args });
          return Promise.resolve(queryResult);
        },
      };

      return builder;
    },
  },
}));

const { getFinancialAuditLog } = await import("./financialAuditLog");

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    clinic_id: "clinic-a",
    table_name: "clinic_invoices",
    record_id: "invoice-1",
    action: "update",
    actor_user_id: "user-1",
    actor_clinic_user_id: "clinic-user-1",
    actor_role: "Owner",
    before_value: { status: "Unpaid" },
    after_value: { status: "Paid" },
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  assertPermission.mockReset();
  assertPermission.mockResolvedValue(undefined);
  queryResult = { data: [], error: null };
  lastCalls = [];
});

describe("getFinancialAuditLog (billing audit fix #5)", () => {
  it("requires ledger permission before returning any entries", async () => {
    await getFinancialAuditLog("clinic_invoices", "invoice-1");

    expect(assertPermission).toHaveBeenCalledWith("ledger");
  });

  it("scopes the query to the exact table and record id, oldest first", async () => {
    await getFinancialAuditLog("clinic_invoices", "invoice-1");

    expect(lastCalls).toContainEqual({ method: "from", args: ["financial_audit_log"] });
    expect(lastCalls).toContainEqual({ method: "eq", args: ["table_name", "clinic_invoices"] });
    expect(lastCalls).toContainEqual({ method: "eq", args: ["record_id", "invoice-1"] });
    expect(lastCalls).toContainEqual({ method: "order", args: ["created_at", { ascending: true }] });
  });

  it("returns the logged entries as-is", async () => {
    const entry = makeEntry();
    queryResult = { data: [entry], error: null };

    const result = await getFinancialAuditLog("clinic_invoices", "invoice-1");

    expect(result).toEqual([entry]);
  });

  it("returns an empty array for a record with no logged history yet", async () => {
    queryResult = { data: [], error: null };

    const result = await getFinancialAuditLog("clinic_payments", "payment-1");

    expect(result).toEqual([]);
  });

  it("throws a safe error rather than returning partial data when the query fails", async () => {
    queryResult = { data: null, error: { message: "boom" } };

    await expect(
      getFinancialAuditLog("clinic_charges", "charge-1")
    ).rejects.toThrow();
  });
});
