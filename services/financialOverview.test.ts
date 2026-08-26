import { beforeEach, describe, expect, it, vi } from "vitest";

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

const getProfitAndLoss = vi.fn();
const getLedgerDashboardTotals = vi.fn();
vi.mock("./ledger", () => ({
  getProfitAndLoss: (...args: unknown[]) => getProfitAndLoss(...args),
  getLedgerDashboardTotals: (...args: unknown[]) => getLedgerDashboardTotals(...args),
}));

const getAccountsReceivableReport = vi.fn();
vi.mock("./accountsReceivable", () => ({
  getAccountsReceivableReport: (...args: unknown[]) => getAccountsReceivableReport(...args),
}));

const getFinancialRatiosReport = vi.fn();
vi.mock("./financialRatios", () => ({
  getFinancialRatiosReport: (...args: unknown[]) => getFinancialRatiosReport(...args),
}));

const getArSummary = vi.fn();
const getDiscountTotal = vi.fn();
vi.mock("./billing", () => ({
  getArSummary: (...args: unknown[]) => getArSummary(...args),
  getDiscountTotal: (...args: unknown[]) => getDiscountTotal(...args),
}));

const getRevenueAnalyticsForPeriod = vi.fn();
vi.mock("./analytics/revenue", () => ({
  getRevenueAnalyticsForPeriod: (...args: unknown[]) => getRevenueAnalyticsForPeriod(...args),
}));

const getRevenueChartData = vi.fn();
vi.mock("./analytics/charts", () => ({
  getRevenueChartData: (...args: unknown[]) => getRevenueChartData(...args),
}));

const getTreatmentProfitabilityReportForPeriod = vi.fn();
vi.mock("./treatmentProfitability", () => ({
  getTreatmentProfitabilityReportForPeriod: (...args: unknown[]) =>
    getTreatmentProfitabilityReportForPeriod(...args),
}));

const getCurrentOrganizationUser = vi.fn();
const getOrganizationFinancials = vi.fn();
vi.mock("./organizations", () => ({
  getCurrentOrganizationUser: (...args: unknown[]) => getCurrentOrganizationUser(...args),
  getOrganizationFinancials: (...args: unknown[]) => getOrganizationFinancials(...args),
}));

const { getFinancialOverview } = await import("./financialOverview");

const RATIO_UNAVAILABLE = { value: null, unavailableReason: "no data" };

function makeRatios(overrides: Record<string, unknown> = {}) {
  return {
    periodLabel: "This Month",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-23",
    balanceSheetAsOf: "2026-08-23",
    liquidity: { currentRatio: RATIO_UNAVAILABLE, quickRatio: RATIO_UNAVAILABLE },
    profitability: {
      grossMarginPercent: { value: 60, unavailableReason: null },
      ebitMarginPercent: RATIO_UNAVAILABLE,
      ebitdaMarginPercent: RATIO_UNAVAILABLE,
      netProfitMarginPercent: { value: 29.5, unavailableReason: null },
      returnOnAssetsPercent: RATIO_UNAVAILABLE,
      returnOnEquityPercent: RATIO_UNAVAILABLE,
    },
    leverage: { debtToEquity: RATIO_UNAVAILABLE, debtRatioPercent: RATIO_UNAVAILABLE },
    efficiency: {
      accountsReceivableDays: RATIO_UNAVAILABLE,
      collectionRatePercent: { value: 82.2, unavailableReason: null },
      accountsPayableDays: RATIO_UNAVAILABLE,
    },
    ...overrides,
  };
}

function makePnl(revenue: number, overrides: Record<string, unknown> = {}) {
  return {
    start: "2026-08-01",
    end: "2026-08-23",
    revenue: { lines: [], total: revenue },
    directCosts: { lines: [], total: 0 },
    grossProfit: revenue,
    operatingExpenses: { lines: [], total: 0 },
    totalOperatingExpenses: 0,
    ebit: revenue,
    netProfit: revenue,
    ebitda: null,
    ...overrides,
  };
}

function makeArReport(overrides: Record<string, unknown> = {}) {
  return {
    totalOutstanding: 860000,
    totalOverdue: 0,
    totalCurrent: 0,
    aging: {
      current: { label: "Current", amount: 0, count: 0 },
      days1to30: { label: "1-30", amount: 0, count: 0 },
      days31to60: { label: "31-60", amount: 0, count: 0 },
      days61to90: { label: "61-90", amount: 0, count: 0 },
      days90plus: { label: "90+", amount: 0, count: 0 },
    },
    periodLabel: "This Month",
    totalInvoiced: 4820000,
    totalCollected: 3960000,
    invoices: [],
    reconciliation: {
      ledgerBalance: 860000,
      invoiceOutstandingBalance: 860000,
      difference: 0,
      matches: true,
    },
    ...overrides,
  };
}

function makeArSummary(overrides: Record<string, unknown> = {}) {
  return {
    totalOutstanding: 860000,
    invoiceCount: 12,
    patientCount: 8,
    buckets: [
      { key: "0-30", label: "0–30 Days", amount: 400000, count: 6 },
      { key: "31-60", label: "31–60 Days", amount: 200000, count: 3 },
      { key: "61-90", label: "61–90 Days", amount: 100000, count: 2 },
      { key: "90+", label: "90+ Days", amount: 160000, count: 1 },
    ],
    oldestInvoice: null,
    largestInvoice: null,
    invoices: [],
    patients: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  getProfitAndLoss.mockResolvedValue(makePnl(4820000));
  getLedgerDashboardTotals.mockResolvedValue({
    cashAndBank: 2180000,
    accountsReceivable: 860000,
    accountsPayable: 120000,
    inventory: 300000,
    revenue: 3960000,
    expenses: 2400000,
    netProfit: 1560000,
    openReconciliationIssues: 0,
  });
  getAccountsReceivableReport.mockResolvedValue(makeArReport());
  getFinancialRatiosReport.mockResolvedValue(makeRatios());
  getArSummary.mockResolvedValue(makeArSummary());
  getDiscountTotal.mockResolvedValue(50000);
  getRevenueAnalyticsForPeriod.mockResolvedValue({
    totalRevenue: 3960000,
    outstandingBalance: 860000,
    totalInvoices: 40,
    paidInvoices: 30,
    unpaidInvoices: 10,
    totalTaxCollected: 771200,
    revenueExcludingTax: 3188800,
  });
  getRevenueChartData.mockResolvedValue([
    { month: "Aug 1", revenue: 100000, tax: 16000 },
    { month: "Aug 2", revenue: 200000, tax: 32000 },
  ]);
  getTreatmentProfitabilityReportForPeriod.mockResolvedValue({
    rows: [
      { id: "t1", name: "Root Canal", performedCount: 8, revenue: 1200000 },
      { id: "t2", name: "Cleaning", performedCount: 40, revenue: 840000 },
      { id: "t3", name: "Never Performed", performedCount: 0, revenue: 0 },
    ],
    summary: { totalRevenue: 2040000 },
    range: "This Month",
  });
  getCurrentOrganizationUser.mockResolvedValue(null);
});

const PERIOD = {
  start: new Date("2026-08-01T00:00:00.000Z"),
  end: new Date("2026-08-23T23:59:59.999Z"),
  label: "August 1 – August 23, 2026",
};

describe("getFinancialOverview (Phase L - composition, never a new calculation)", () => {
  it("asserts ledger permission before composing anything", async () => {
    await getFinancialOverview(PERIOD, "This Month");
    expect(assertPermission).toHaveBeenCalledWith("ledger");
  });

  it("takes Revenue/Net Profit/Gross Profit from P&L (accrual), never from getLedgerDashboardTotals", async () => {
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.current.revenue).toBe(4820000);
    expect(overview.current.netProfit).toBe(4820000); // from makePnl, not dashboardTotals' 1560000
    expect(overview.current.grossProfit).toBe(4820000);
  });

  it("takes Collected/Invoiced from the AR report, and margins/collection rate from Financial Ratios", async () => {
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.current.totalCollected).toBe(3960000);
    expect(overview.current.totalInvoiced).toBe(4820000);
    expect(overview.current.collectionRatePercent.value).toBe(82.2);
    expect(overview.current.netProfitMarginPercent.value).toBe(29.5);
  });

  it("reuses Phase K's getArSummary() verbatim for AR Health, not a re-derived aging", async () => {
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.ar.totalOutstanding).toBe(860000);
    expect(overview.ar.buckets).toHaveLength(4);
    expect(getArSummary).toHaveBeenCalledTimes(1);
  });

  it("computes a deterministic AR risk level from the 61-90/90+ share of outstanding AR", async () => {
    // 100000 + 160000 = 260000 of 860000 = 30.2% -> High Aging Exposure
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.arAgingOver60Percent).toBeCloseTo(30.23, 1);
    expect(overview.arRiskLevel).toBe("High Aging Exposure");
  });

  it("reports 'No Outstanding AR' when nothing is outstanding, never a division by zero", async () => {
    getArSummary.mockResolvedValue(
      makeArSummary({
        totalOutstanding: 0,
        buckets: [
          { key: "0-30", label: "0–30 Days", amount: 0, count: 0 },
          { key: "31-60", label: "31–60 Days", amount: 0, count: 0 },
          { key: "61-90", label: "61–90 Days", amount: 0, count: 0 },
          { key: "90+", label: "90+ Days", amount: 0, count: 0 },
        ],
      })
    );

    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.arRiskLevel).toBe("No Outstanding AR");
    expect(overview.arAgingOver60Percent).toBeNull();
  });

  it("flags a reconciliation mismatch when the ledger AR balance disagrees with invoice balances, rather than silently averaging them", async () => {
    getAccountsReceivableReport.mockResolvedValue(
      makeArReport({
        reconciliation: {
          ledgerBalance: 900000,
          invoiceOutstandingBalance: 860000,
          difference: 40000,
          matches: false,
        },
      })
    );

    const overview = await getFinancialOverview(PERIOD, "This Month");

    const check = overview.reconciliation.find((c) => c.key === "ar-ledger-vs-invoices");
    expect(check?.matches).toBe(false);
    expect(check?.difference).toBe(-40000);
    expect(overview.reconciled).toBe(false);
  });

  it("flags a reconciliation mismatch when P&L revenue disagrees with the AR report's invoiced total", async () => {
    getProfitAndLoss.mockResolvedValue(makePnl(5000000));

    const overview = await getFinancialOverview(PERIOD, "This Month");

    const check = overview.reconciliation.find((c) => c.key === "revenue-vs-ar-invoiced");
    expect(check?.matches).toBe(false);
    expect(overview.reconciled).toBe(false);
  });

  it("is reconciled when every check matches and there are zero open ledger issues", async () => {
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.reconciliation.every((c) => c.matches)).toBe(true);
    expect(overview.reconciled).toBe(true);
  });

  it("is NOT reconciled when checks pass but the ledger has open reconciliation issues", async () => {
    getLedgerDashboardTotals.mockResolvedValue({
      cashAndBank: 2180000,
      accountsReceivable: 860000,
      accountsPayable: 120000,
      inventory: 300000,
      revenue: 3960000,
      expenses: 2400000,
      netProfit: 1560000,
      openReconciliationIssues: 2,
    });

    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.reconciliation.every((c) => c.matches)).toBe(true);
    expect(overview.reconciled).toBe(false);
  });

  it("excludes zero-performed treatments and sorts the rest by revenue descending", async () => {
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.topTreatments).toHaveLength(2);
    expect(overview.topTreatments[0].name).toBe("Root Canal");
    expect(overview.topTreatments[0].percentOfTotal).toBeCloseTo((1200000 / 2040000) * 100, 5);
  });

  it("skips the revenue trend chart for a Custom Range instead of calling getRevenueChartData with an unsupported string", async () => {
    const overview = await getFinancialOverview(PERIOD, "Custom Range");

    expect(overview.chart).toBeNull();
    expect(getRevenueChartData).not.toHaveBeenCalled();
  });

  it("fetches the trend chart for a named range", async () => {
    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.chart).toHaveLength(2);
    expect(getRevenueChartData).toHaveBeenCalledWith("This Month");
  });

  it("omits branch performance entirely when the current user is not an organization CEO", async () => {
    getCurrentOrganizationUser.mockResolvedValue(null);

    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.branchPerformance).toBeNull();
    expect(getOrganizationFinancials).not.toHaveBeenCalled();
  });

  it("includes branch performance for an organization CEO", async () => {
    getCurrentOrganizationUser.mockResolvedValue({
      id: "ou-1",
      organization_id: "org-1",
      auth_user_id: "u-1",
      role: "CEO",
      active_clinic_id: "clinic-1",
      created_at: "2026-01-01",
    });
    getOrganizationFinancials.mockResolvedValue({
      currencyConsistent: true,
      currency: "KES",
      branchCurrencies: [],
      revenue: 3000000,
      directCosts: 0,
      grossProfit: 3000000,
      grossMarginPercent: 100,
      expenses: 0,
      netProfit: 3000000,
      ebit: 3000000,
      ebitdaAvailable: false,
      ebitdaBranchesIncluded: 0,
      ebitdaBranchesTotal: 2,
      ebitda: null,
      branches: [
        {
          clinic_id: "clinic-1",
          clinic_name: "Westlands",
          currency: "KES",
          revenue: 1800000,
          directCosts: 0,
          grossProfit: 1800000,
          expenses: 0,
          netProfit: 1800000,
          ebit: 1800000,
          ebitdaAvailable: false,
          ebitda: null,
        },
        {
          clinic_id: "clinic-2",
          clinic_name: "Karen",
          currency: "KES",
          revenue: 1200000,
          directCosts: 0,
          grossProfit: 1200000,
          expenses: 0,
          netProfit: 1200000,
          ebit: 1200000,
          ebitdaAvailable: false,
          ebitda: null,
        },
      ],
    });

    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.branchPerformance?.branches).toHaveLength(2);
    expect(getOrganizationFinancials).toHaveBeenCalledWith("org-1", PERIOD.start, PERIOD.end);
  });

  it("never lets a branch-performance failure break the rest of the dashboard", async () => {
    getCurrentOrganizationUser.mockResolvedValue({
      id: "ou-1",
      organization_id: "org-1",
      auth_user_id: "u-1",
      role: "CEO",
      active_clinic_id: "clinic-1",
      created_at: "2026-01-01",
    });
    getOrganizationFinancials.mockRejectedValue(new Error("boom"));

    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.branchPerformance).toBeNull();
    expect(overview.current.revenue).toBe(4820000);
  });

  it("computes a period-over-period percent change for Revenue and Collected", async () => {
    getProfitAndLoss
      .mockResolvedValueOnce(makePnl(4820000)) // current period
      .mockResolvedValueOnce(makePnl(4220000)); // previous period

    getAccountsReceivableReport
      .mockResolvedValueOnce(makeArReport({ totalCollected: 3960000 })) // current
      .mockResolvedValueOnce(makeArReport({ totalCollected: 3606000 })); // previous

    const overview = await getFinancialOverview(PERIOD, "This Month");

    expect(overview.comparison?.revenueChangePercent).toBeCloseTo(
      ((4820000 - 4220000) / 4220000) * 100,
      5
    );
    expect(overview.comparison?.collectedChangePercent).toBeCloseTo(
      ((3960000 - 3606000) / 3606000) * 100,
      5
    );
  });
});
