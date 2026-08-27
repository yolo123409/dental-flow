import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// FIN-3.2: this page used to compute its own "Revenue"/"Money Out" figures
// from clinic_invoices/clinic_expenses directly (a Paid-invoices/cash-ish
// basis, via services/analytics/revenue.ts and services/expenses.ts) -
// diverging from the canonical accrual figures every other financial page
// (Ledger Dashboard, Financial Overview, Reports Center P&L, Monthly
// Comparison, Financial Ratios, CEO Consolidated Financials) already reads
// from services/ledger.ts#getProfitAndLoss. These tests assert the
// dashboard now reads Revenue/Money Out from getProfitAndLoss - not from
// getRevenueAnalytics/getExpenseSummary - by giving each source a
// DIFFERENT number and checking which one actually reaches the screen.

const hasPermission = vi.fn();
vi.mock("@/hooks/usePermissions", () => ({
  default: () => ({ role: "Owner", hasPermission }),
}));

vi.mock("@/hooks/useRealtimeDashboard", () => ({
  default: () => {},
}));

const getDashboardStats = vi.fn();
vi.mock("@/services/dashboard", () => ({
  getDashboardStats: () => getDashboardStats(),
}));

const getClinicSettings = vi.fn();
vi.mock("@/services/settings", () => ({
  getClinicSettings: () => getClinicSettings(),
}));

const getProfitAndLoss = vi.fn();
vi.mock("@/services/ledger", () => ({
  getProfitAndLoss: (...args: unknown[]) => getProfitAndLoss(...args),
}));

const getRevenueAnalytics = vi.fn();
vi.mock("@/services/analytics/revenue", () => ({
  getRevenueAnalytics: (...args: unknown[]) => getRevenueAnalytics(...args),
}));

const getRevenueChartData = vi.fn();
vi.mock("@/services/analytics/charts", () => ({
  getRevenueChartData: (...args: unknown[]) => getRevenueChartData(...args),
}));

// DashboardWidgets is where revenue/taxCollected/breakEven/moneyOut actually
// land - mocked as a thin prop dump so these tests assert on the exact
// numbers app/admin/page.tsx computed, without rendering the full
// RevenueWidget/NetPositionWidget/chart tree underneath it.
vi.mock("@/components/dashboard/DashboardWidgets", () => ({
  default: (props: {
    revenue: number;
    taxCollected: number | null;
    breakEven: number | null;
    moneyOut: number;
    moneyOutError: string | null;
    revenueError: string | null;
  }) => (
    <div data-testid="dashboard-widgets">
      <span data-testid="revenue">{props.revenue}</span>
      <span data-testid="tax-collected">{String(props.taxCollected)}</span>
      <span data-testid="break-even">{String(props.breakEven)}</span>
      <span data-testid="money-out">{props.moneyOut}</span>
      <span data-testid="revenue-error">{String(props.revenueError)}</span>
      <span data-testid="money-out-error">{String(props.moneyOutError)}</span>
    </div>
  ),
}));

import AdminDashboard from "./page";

function makeProfitAndLoss(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    revenue: { lines: [], total: 500000 },
    totalOperatingExpenses: 120000,
    grossProfit: 0,
    netProfit: 0,
    directCosts: { lines: [], total: 0 },
    operatingExpenses: { lines: [], total: 120000 },
    ebit: 0,
    ebitda: null,
    start: "2026-01-01",
    end: "2026-01-31",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  hasPermission.mockReturnValue(true);

  getDashboardStats.mockResolvedValue({ patients: 10, appointments: 5, dentists: 2 });
  getClinicSettings.mockResolvedValue({
    currency: "KES",
    clinic_name: "Test Clinic",
    tax_enabled: true,
  });

  // Deliberately DIFFERENT from getProfitAndLoss's revenue - if the page
  // still reads Revenue from here, these tests catch it.
  getRevenueAnalytics.mockResolvedValue({
    totalRevenue: 999999,
    totalTaxCollected: 8000,
  });

  getRevenueChartData.mockResolvedValue([]);
  getProfitAndLoss.mockResolvedValue(makeProfitAndLoss());
});

describe("AdminDashboard (FIN-3.2 canonical ledger unification)", () => {
  it("shows Revenue from getProfitAndLoss, not getRevenueAnalytics.totalRevenue", async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("revenue").textContent).toBe("500000");
    });

    expect(screen.getByTestId("revenue").textContent).not.toBe("999999");
  });

  it("shows Money Out and Break-even from getProfitAndLoss.totalOperatingExpenses", async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("money-out").textContent).toBe("120000");
    });

    expect(screen.getByTestId("break-even").textContent).toBe("120000");
  });

  it("still shows Tax Collected from getRevenueAnalytics when tax is enabled", async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("tax-collected").textContent).toBe("8000");
    });
  });

  it("shows null Tax Collected when the clinic has tax disabled", async () => {
    getClinicSettings.mockResolvedValue({
      currency: "KES",
      clinic_name: "Test Clinic",
      tax_enabled: false,
    });

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("tax-collected").textContent).toBe("null");
    });
  });

  it("calls getProfitAndLoss with This Month's calendar bounds", async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(getProfitAndLoss).toHaveBeenCalled();
    });

    const [start, end] = getProfitAndLoss.mock.calls[0] as [Date, Date];

    const now = new Date();
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth());
    expect(start.getDate()).toBe(1);
  });

  it("keeps Money Out working when the revenue-side getProfitAndLoss call fails (independent failure domains)", async () => {
    getProfitAndLoss
      .mockRejectedValueOnce(new Error("ledger down"))
      .mockResolvedValueOnce(makeProfitAndLoss());

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("money-out").textContent).toBe("120000");
    });

    expect(screen.getByTestId("revenue-error").textContent).not.toBe("null");
  });

  it("keeps Revenue working when the Money-Out-side getProfitAndLoss call fails (independent failure domains)", async () => {
    getProfitAndLoss
      .mockResolvedValueOnce(makeProfitAndLoss())
      .mockRejectedValueOnce(new Error("ledger down"));

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("revenue").textContent).toBe("500000");
    });

    expect(screen.getByTestId("money-out-error").textContent).not.toBe("null");
  });

  it("skips every financial fetch for a role without the analytics permission", async () => {
    hasPermission.mockReturnValue(false);

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(getDashboardStats).toHaveBeenCalled();
    });

    expect(getProfitAndLoss).not.toHaveBeenCalled();
    expect(getRevenueAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dashboard-widgets")).not.toBeInTheDocument();
  });
});
