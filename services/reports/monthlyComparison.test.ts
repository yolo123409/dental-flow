import { beforeEach, describe, expect, it, vi } from "vitest";

const getClinicMeta = vi.fn();
const getPeriodFinancials = vi.fn();

vi.mock("./shared", () => ({
  getClinicMeta: () => getClinicMeta(),
  getPeriodFinancials: (...args: unknown[]) => getPeriodFinancials(...args),
}));

function createSupabaseCountMock() {
  const builder: {
    select: (...args: unknown[]) => typeof builder;
    eq: (...args: unknown[]) => typeof builder;
    gte: (...args: unknown[]) => typeof builder;
    lte: (...args: unknown[]) => typeof builder;
    then: (resolve: (value: { count: number; data: null; error: null }) => unknown) => unknown;
  } = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    then: (resolve) => Promise.resolve({ count: 0, data: null, error: null }).then(resolve),
  };

  return { from: () => builder };
}

vi.mock("@/lib/supabase", () => ({
  supabase: createSupabaseCountMock(),
}));

const { generateMonthlyComparisonReport } = await import("./monthlyComparison");

const PERIOD = { label: "unused", start: null, end: null };

beforeEach(() => {
  vi.clearAllMocks();
  getClinicMeta.mockResolvedValue({
    clinicId: "clinic-a",
    clinicName: "Test Clinic",
    currency: "KES",
  });
});

describe("generateMonthlyComparisonReport (FIN-1 - every compared period uses the same accounting basis)", () => {
  it("calls the ledger-derived getPeriodFinancials exactly once per compared period (current, previous month, same month last year)", async () => {
    getPeriodFinancials.mockResolvedValue({
      revenue: 100,
      directCosts: 0,
      expenses: 0,
      grossProfit: 100,
      netProfit: 100,
    });

    await generateMonthlyComparisonReport(PERIOD, {});

    expect(getPeriodFinancials).toHaveBeenCalledTimes(3);
  });

  it("builds Revenue/Expenses/Gross Profit/Net Profit comparison rows straight from getPeriodFinancials, never mixing in a different revenue definition for one period", async () => {
    getPeriodFinancials
      .mockResolvedValueOnce({ revenue: 500000, directCosts: 20000, expenses: 100000, grossProfit: 480000, netProfit: 380000 })
      .mockResolvedValueOnce({ revenue: 400000, directCosts: 15000, expenses: 90000, grossProfit: 385000, netProfit: 295000 })
      .mockResolvedValueOnce({ revenue: 300000, directCosts: 10000, expenses: 80000, grossProfit: 290000, netProfit: 210000 });

    const report = await generateMonthlyComparisonReport(PERIOD, {});

    const revenueRow = report.rows.find(
      (row) => (row as { metric: string }).metric === "Revenue"
    ) as { current: number; previous: number; sameMonthLastYear: number } | undefined;

    expect(revenueRow).toMatchObject({
      current: 500000,
      previous: 400000,
      sameMonthLastYear: 300000,
    });

    const netProfitRow = report.rows.find(
      (row) => (row as { metric: string }).metric === "Net Profit"
    ) as { current: number; previous: number } | undefined;

    expect(netProfitRow).toMatchObject({ current: 380000, previous: 295000 });
  });
});
