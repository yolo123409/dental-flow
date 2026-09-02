import { beforeEach, describe, expect, it, vi } from "vitest";

const getClinicMeta = vi.fn();
vi.mock("./shared", () => ({
  getClinicMeta: () => getClinicMeta(),
  periodLabel: () => "This Month",
}));

// fetchAllRows's real implementation pages via .range() until a short
// page comes back - a single-page invocation of the given query-builder
// callback is enough to exercise this report's own query construction
// and row-mapping logic without reimplementing pagination here.
vi.mock("@/lib/fetchAllRows", () => ({
  fetchAllRows: async (fn: (from: number, to: number) => Promise<{ data: unknown }>) => {
    const { data } = await fn(0, 999);
    return data ?? [];
  },
}));

let queryCalls: Array<{ method: string; args: unknown[] }>;
let canned: unknown[];

function stubQuery() {
  const record = (method: string) => (...args: unknown[]) => {
    queryCalls.push({ method, args });
    return builder;
  };

  const builder = {
    select: record("select"),
    eq: record("eq"),
    neq: record("neq"),
    order: record("order"),
    gte: record("gte"),
    lte: record("lte"),
    range: () => Promise.resolve({ data: canned, error: null }),
  };

  return builder;
}

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return { from: () => stubQuery() };
  },
}));

const { generateOutstandingBalancesReport } = await import(
  "./outstandingBalances"
);

beforeEach(() => {
  getClinicMeta.mockReset();
  getClinicMeta.mockResolvedValue({
    clinicId: "clinic-a",
    clinicName: "Test Clinic",
    currency: "KES",
  });
  queryCalls = [];
  canned = [];
});

const PERIOD = { start: null, end: null } as unknown as Parameters<
  typeof generateOutstandingBalancesReport
>[0];

describe("generateOutstandingBalancesReport (Critical Safety Closure fix #4 - Voided invoices must never appear as collectible debt)", () => {
  it("reads the stored balance column rather than recomputing total - amount_paid, so a Voided invoice's stale total never inflates the outstanding figure", async () => {
    canned = [
      {
        id: "inv-1",
        invoice_number: "INV-001",
        created_at: "2026-01-01T00:00:00Z",
        total: 5000,
        amount_paid: 2000,
        balance: 3000,
        patients: { first_name: "Jane", last_name: "Doe" },
      },
    ];

    const report = await generateOutstandingBalancesReport(PERIOD, {});

    expect(report.rows).toEqual([
      expect.objectContaining({ outstanding: 3000, total: 5000, paid: 2000 }),
    ]);
  });

  it("excludes Voided invoices at the query level (status filter includes Voided alongside Paid)", async () => {
    canned = [];

    await generateOutstandingBalancesReport(PERIOD, {});

    expect(queryCalls).toContainEqual({
      method: "neq",
      args: ["status", "Paid"],
    });
    expect(queryCalls).toContainEqual({
      method: "neq",
      args: ["status", "Voided"],
    });
  });
});
