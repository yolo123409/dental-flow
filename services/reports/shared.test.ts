import { beforeEach, describe, expect, it, vi } from "vitest";

// getClinicMeta (this module's other export, not under test here) pulls
// in services/clinic.ts and services/settings.ts, which construct a real
// supabase-js client at module scope - same workaround used throughout
// this test suite (see services/patientTeeth.test.ts and others).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const getProfitAndLoss = vi.fn();
vi.mock("@/services/ledger", () => ({
  getProfitAndLoss: (...args: unknown[]) => getProfitAndLoss(...args),
}));

const { getPeriodFinancials } = await import("./shared");

function makePnl(overrides: Record<string, unknown> = {}) {
  return {
    start: "2026-08-01",
    end: "2026-08-23",
    revenue: { lines: [], total: 25000 },
    directCosts: { lines: [], total: 800 },
    grossProfit: 24200,
    operatingExpenses: { lines: [], total: 2000 },
    totalOperatingExpenses: 2000,
    ebit: 22200,
    netProfit: 22200,
    ebitda: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProfitAndLoss.mockResolvedValue(makePnl());
});

describe("getPeriodFinancials (FIN-1 - thin adapter over the ledger P&L, not a second calculation)", () => {
  it("takes Revenue/Direct Costs/Operating Expenses/Gross Profit/Net Profit verbatim from getProfitAndLoss", async () => {
    const result = await getPeriodFinancials(new Date("2026-08-01"), new Date("2026-08-23"));

    expect(result).toEqual({
      revenue: 25000,
      directCosts: 800,
      expenses: 2000,
      grossProfit: 24200,
      netProfit: 22200,
    });
  });

  it("passes the given start/end straight through to getProfitAndLoss unchanged", async () => {
    const start = new Date("2026-08-01");
    const end = new Date("2026-08-23");

    await getPeriodFinancials(start, end);

    expect(getProfitAndLoss).toHaveBeenCalledWith(start, end, undefined);
  });

  it("normalizes a null start to the Unix epoch and a null end to now, rather than calling getProfitAndLoss with null", async () => {
    await getPeriodFinancials(null, null);

    expect(getProfitAndLoss).toHaveBeenCalledTimes(1);

    const [start, end] = getProfitAndLoss.mock.calls[0] as [Date, Date];

    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect(start.getTime()).toBe(0);
    expect(end.getTime()).toBeGreaterThan(0);
  });

  it("forwards overrideClinicId through to getProfitAndLoss for organization/branch scoping", async () => {
    const start = new Date("2026-08-01");
    const end = new Date("2026-08-23");

    await getPeriodFinancials(start, end, "clinic-b");

    expect(getProfitAndLoss).toHaveBeenCalledWith(start, end, "clinic-b");
  });

  it("does not carry a costCoveragePercent field - that stays exclusive to Treatment Profitability", async () => {
    const result = await getPeriodFinancials(new Date("2026-08-01"), new Date("2026-08-23"));

    expect(result).not.toHaveProperty("costCoveragePercent");
  });
});
