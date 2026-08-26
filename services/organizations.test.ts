import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FIN-1.5: exercises the REAL getOrganizationFinancials() implementation
 * (services/organizations.ts) against a mocked Supabase boundary, mocking
 * only the two multi-clinic ledger primitives it calls
 * (getProfitAndLossForClinics/getEbitEbitdaForClinics) - the same
 * "mock one layer down, run the real code above it" style used for
 * services/financialOverview.test.ts. This proves the consolidation
 * itself (summing per-branch canonical ledger results) is correct,
 * without re-testing getProfitAndLoss()'s own internals (already covered
 * by services/ledger.test.ts).
 */

const getProfitAndLossForClinics = vi.fn();
const getEbitEbitdaForClinics = vi.fn();

vi.mock("./ledger", () => ({
  getProfitAndLossForClinics: (...args: unknown[]) => getProfitAndLossForClinics(...args),
  getEbitEbitdaForClinics: (...args: unknown[]) => getEbitEbitdaForClinics(...args),
}));

const CEO_AUTH_ID = "auth-ceo-1";
const ORG_ID = "org-1";
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";

interface BranchRow {
  id: string;
  name: string;
  organization_id: string;
  created_at: string;
}

interface SettingsRow {
  clinic_id: string;
  currency: string;
}

let branchRows: BranchRow[] = [];
let settingsRows: SettingsRow[] = [];

function createMockClient() {
  const from = vi.fn((table: string) => {
    const builder: {
      select: (...args: unknown[]) => typeof builder;
      eq: (...args: unknown[]) => typeof builder;
      in: (...args: unknown[]) => typeof builder;
      order: (...args: unknown[]) => typeof builder;
      maybeSingle: (...args: unknown[]) => typeof builder;
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => unknown;
    } = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      maybeSingle: () => builder,
      then: (resolve) => {
        if (table === "organization_users") {
          return Promise.resolve({
            data: {
              id: "ou-1",
              organization_id: ORG_ID,
              auth_user_id: CEO_AUTH_ID,
              role: "CEO",
              active_clinic_id: CLINIC_A,
              created_at: "2026-01-01",
            },
            error: null,
          }).then(resolve);
        }

        if (table === "clinics") {
          return Promise.resolve({ data: branchRows, error: null }).then(resolve);
        }

        if (table === "clinic_settings") {
          return Promise.resolve({ data: settingsRows, error: null }).then(resolve);
        }

        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };

    return builder;
  });

  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: CEO_AUTH_ID } }, error: null }),
    },
    from,
  };
}

let mockClient: ReturnType<typeof createMockClient>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const { getOrganizationFinancials } = await import("./organizations");

const START = new Date("2026-08-01T00:00:00.000Z");
const END = new Date("2026-08-23T23:59:59.999Z");

function pl(revenue: number, directCosts: number, operatingExpenses: number) {
  const grossProfit = revenue - directCosts;
  const netProfit = grossProfit - operatingExpenses;

  return {
    start: "2026-08-01",
    end: "2026-08-23",
    revenue: { lines: [], total: revenue },
    directCosts: { lines: [], total: directCosts },
    grossProfit,
    operatingExpenses: { lines: [], total: operatingExpenses },
    totalOperatingExpenses: operatingExpenses,
    ebit: netProfit,
    netProfit,
    ebitda: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient = createMockClient();

  branchRows = [
    { id: CLINIC_A, name: "Branch A", organization_id: ORG_ID, created_at: "2026-01-01" },
    { id: CLINIC_B, name: "Branch B", organization_id: ORG_ID, created_at: "2026-01-02" },
  ];
  settingsRows = [
    { clinic_id: CLINIC_A, currency: "KES" },
    { clinic_id: CLINIC_B, currency: "KES" },
  ];

  getEbitEbitdaForClinics.mockResolvedValue(new Map());
});

describe("getOrganizationFinancials (FIN-1.5 - sums each branch's canonical ledger P&L, not an independent formula)", () => {
  it("consolidates Revenue/Expenses/Net Profit as the exact sum of each branch's ledger P&L (the brief's deterministic scenario)", async () => {
    // Clinic A: Ledger Revenue 100,000 / Expenses 20,000 / Net Profit 80,000
    // Clinic B: Ledger Revenue 50,000 / Expenses 10,000 / Net Profit 40,000
    // Organization: Revenue 150,000 / Expenses 30,000 / Net Profit 120,000
    getProfitAndLossForClinics.mockResolvedValue(
      new Map([
        [CLINIC_A, pl(100000, 0, 20000)],
        [CLINIC_B, pl(50000, 0, 10000)],
      ])
    );

    const result = await getOrganizationFinancials(ORG_ID, START, END);

    expect(result.revenue).toBe(150000);
    expect(result.expenses).toBe(30000);
    expect(result.netProfit).toBe(120000);
  });

  it("reports each branch's own figures unchanged - identical to what that branch's own Ledger P&L page would show", async () => {
    getProfitAndLossForClinics.mockResolvedValue(
      new Map([
        [CLINIC_A, pl(100000, 0, 20000)],
        [CLINIC_B, pl(50000, 0, 10000)],
      ])
    );

    const result = await getOrganizationFinancials(ORG_ID, START, END);

    const branchA = result.branches.find((b) => b.clinic_id === CLINIC_A);
    const branchB = result.branches.find((b) => b.clinic_id === CLINIC_B);

    expect(branchA).toMatchObject({ revenue: 100000, expenses: 20000, netProfit: 80000 });
    expect(branchB).toMatchObject({ revenue: 50000, expenses: 10000, netProfit: 40000 });
  });

  it("consolidates real ledger-recorded Direct Costs into Gross Profit, never a manual treatment-profitability estimate", async () => {
    getProfitAndLossForClinics.mockResolvedValue(
      new Map([
        [CLINIC_A, pl(100000, 8000, 20000)],
        [CLINIC_B, pl(50000, 0, 10000)],
      ])
    );

    const result = await getOrganizationFinancials(ORG_ID, START, END);

    expect(result.directCosts).toBe(8000);
    expect(result.grossProfit).toBe(142000);
    expect(result.netProfit).toBe(112000);
  });

  it("passes exactly this organization's branch ids and the given date range through to getProfitAndLossForClinics", async () => {
    getProfitAndLossForClinics.mockResolvedValue(new Map());

    await getOrganizationFinancials(ORG_ID, START, END);

    expect(getProfitAndLossForClinics).toHaveBeenCalledWith([CLINIC_A, CLINIC_B], START, END);
  });

  it("scopes to only the branches of the given organization (clinic filtering)", async () => {
    branchRows = [{ id: CLINIC_A, name: "Branch A", organization_id: ORG_ID, created_at: "2026-01-01" }];
    settingsRows = [{ clinic_id: CLINIC_A, currency: "KES" }];
    getProfitAndLossForClinics.mockResolvedValue(new Map([[CLINIC_A, pl(100000, 0, 20000)]]));

    const result = await getOrganizationFinancials(ORG_ID, START, END);

    expect(result.branches).toHaveLength(1);
    expect(getProfitAndLossForClinics).toHaveBeenCalledWith([CLINIC_A], START, END);
  });

  it("uses a different requested date range unmodified for both branches", async () => {
    const customStart = new Date("2026-01-01T00:00:00.000Z");
    const customEnd = new Date("2026-01-31T23:59:59.999Z");
    getProfitAndLossForClinics.mockResolvedValue(new Map());

    await getOrganizationFinancials(ORG_ID, customStart, customEnd);

    expect(getProfitAndLossForClinics).toHaveBeenCalledWith(
      [CLINIC_A, CLINIC_B],
      customStart,
      customEnd
    );
  });

  it("zeroes every blended figure but still lists correct per-branch detail when branches use different currencies", async () => {
    settingsRows = [
      { clinic_id: CLINIC_A, currency: "KES" },
      { clinic_id: CLINIC_B, currency: "USD" },
    ];
    getProfitAndLossForClinics.mockResolvedValue(
      new Map([
        [CLINIC_A, pl(100000, 0, 20000)],
        [CLINIC_B, pl(50000, 0, 10000)],
      ])
    );

    const result = await getOrganizationFinancials(ORG_ID, START, END);

    expect(result.currencyConsistent).toBe(false);
    expect(result.revenue).toBe(0);
    expect(result.branches).toHaveLength(2);
    expect(result.branches.find((b) => b.clinic_id === CLINIC_A)).toMatchObject({ revenue: 100000 });
  });

  it("keeps EBIT/EBITDA as their own genuinely distinct figures from getEbitEbitdaForClinics, never derived from Net Profit here", async () => {
    getProfitAndLossForClinics.mockResolvedValue(
      new Map([
        [CLINIC_A, pl(100000, 0, 20000)],
        [CLINIC_B, pl(50000, 0, 10000)],
      ])
    );
    getEbitEbitdaForClinics.mockResolvedValue(
      new Map([
        [CLINIC_A, { ebit: 79000, ebitdaAvailable: true, ebitda: 85000 }],
        [CLINIC_B, { ebit: 39000, ebitdaAvailable: false, ebitda: null }],
      ])
    );

    const result = await getOrganizationFinancials(ORG_ID, START, END);

    expect(result.ebit).toBe(118000);
    expect(result.ebitdaBranchesIncluded).toBe(1);
    expect(result.ebitdaBranchesTotal).toBe(2);
    expect(result.ebitda).toBe(85000);
    // Net Profit (from the ledger P&L) is untouched by EBIT being different.
    expect(result.netProfit).toBe(120000);
  });
});
