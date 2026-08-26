import { beforeEach, describe, expect, it, vi } from "vitest";

const getClinicMeta = vi.fn();
const getPeriodFinancials = vi.fn();

vi.mock("./shared", () => ({
  getClinicMeta: () => getClinicMeta(),
  getPeriodFinancials: (...args: unknown[]) => getPeriodFinancials(...args),
  periodLabel: () => "August 1 – August 23, 2026",
}));

const { generateProfitLossReport } = await import("./profitLoss");

const PERIOD = {
  label: "This Month",
  start: new Date("2026-08-01"),
  end: new Date("2026-08-23"),
};

beforeEach(() => {
  vi.clearAllMocks();
  getClinicMeta.mockResolvedValue({
    clinicId: "clinic-a",
    clinicName: "Test Clinic",
    currency: "KES",
  });
});

describe("generateProfitLossReport (FIN-1 - Reports Center P&L is now ledger-canonical)", () => {
  it("builds Revenue/Direct Costs/Gross Profit/Operating Expenses/Net Profit rows straight from the ledger-derived getPeriodFinancials", async () => {
    getPeriodFinancials.mockResolvedValue({
      revenue: 25000,
      directCosts: 800,
      expenses: 2000,
      grossProfit: 24200,
      netProfit: 22200,
    });

    const report = await generateProfitLossReport(PERIOD, {});

    expect(report.rows).toEqual([
      { line: "Revenue", amount: 25000 },
      { line: "Direct Treatment Costs", amount: -800 },
      { line: "Gross Profit", amount: 24200 },
      { line: "Operating Expenses", amount: -2000 },
      { line: "Net Profit", amount: 22200 },
    ]);
  });

  it("never uses Paid-invoices-only revenue or a manually configured direct_cost estimate for these figures (no such calls exist to make)", async () => {
    // There is nothing left in this module that could call
    // getRevenueAnalyticsForPeriod/getTreatmentProfitabilityReportForPeriod/
    // getExpenses directly - every figure must come from the single
    // getPeriodFinancials call this test controls.
    getPeriodFinancials.mockResolvedValue({
      revenue: 4820000,
      directCosts: 0,
      expenses: 2400000,
      grossProfit: 4820000,
      netProfit: 2420000,
    });

    const report = await generateProfitLossReport(PERIOD, {});

    expect(getPeriodFinancials).toHaveBeenCalledTimes(1);
    expect(report.summaryCards[0].label).toBe("Revenue");
  });

  it("does not warn about incomplete direct costs when the ledger shows real recorded inventory consumption", async () => {
    getPeriodFinancials.mockResolvedValue({
      revenue: 25000,
      directCosts: 800,
      expenses: 2000,
      grossProfit: 24200,
      netProfit: 22200,
    });

    const report = await generateProfitLossReport(PERIOD, {});

    expect(report.notices?.some((n) => n.tone === "warning")).toBe(false);
  });

  it("warns that no inventory consumption has been recorded when the ledger's Direct Costs is exactly zero", async () => {
    getPeriodFinancials.mockResolvedValue({
      revenue: 25000,
      directCosts: 0,
      expenses: 2000,
      grossProfit: 25000,
      netProfit: 23000,
    });

    const report = await generateProfitLossReport(PERIOD, {});

    expect(
      report.notices?.some(
        (n) => n.tone === "warning" && n.message.includes("Supplies Used")
      )
    ).toBe(true);
  });

  it("always includes the info notice distinguishing this ledger-based P&L from Treatment Profitability's own estimate-based Gross Profit", async () => {
    getPeriodFinancials.mockResolvedValue({
      revenue: 0,
      directCosts: 0,
      expenses: 0,
      grossProfit: 0,
      netProfit: 0,
    });

    const report = await generateProfitLossReport(PERIOD, {});

    expect(report.notices?.[0]).toMatchObject({ tone: "info" });
    expect(report.notices?.[0].message).toContain("Treatment Profitability");
  });
});
