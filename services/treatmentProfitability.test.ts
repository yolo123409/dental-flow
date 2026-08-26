import { beforeEach, describe, expect, it, vi } from "vitest";

// FIN-2: exercises the REAL getTreatmentProfitabilityReportForPeriod()
// implementation against a mocked Supabase boundary - proves the
// estimated-vs-actual split (services/treatmentProfitability.ts) is
// computed correctly, without a live database.

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

interface CatalogRow {
  id: string;
  name: string;
  category: string;
  default_price: number;
  direct_cost: number | null;
}

let catalogRows: CatalogRow[] = [];
let actualsRows: {
  clinic_id: string;
  treatment_name_normalized: string;
  performed_count: number;
  revenue: number;
}[] = [];
let actualMaterialCostRows: {
  clinic_id: string;
  treatment_name_normalized: string;
  actual_material_cost: number;
}[] = [];

function createSupabaseMock() {
  return {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: catalogRows, error: null }).then(resolve),
      };
      return builder;
    },
    rpc: vi.fn((name: string) => {
      if (name === "get_treatment_actuals_multi") {
        return Promise.resolve({ data: actualsRows, error: null });
      }
      if (name === "get_treatment_actual_material_costs_multi") {
        return Promise.resolve({ data: actualMaterialCostRows, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    }),
  };
}

let mockClient: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const { getTreatmentProfitabilityReportForPeriod } = await import(
  "./treatmentProfitability"
);

const CLINIC_ID = "clinic-1";
const START = new Date("2026-08-01");
const END = new Date("2026-08-23");

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  mockClient = createSupabaseMock();

  catalogRows = [];
  actualsRows = [];
  actualMaterialCostRows = [];
});

describe("getTreatmentProfitabilityReportForPeriod (FIN-2 - estimated vs actual cost)", () => {
  it("computes estimatedDirectCosts/estimatedGrossProfit from the catalog's configured direct_cost (unchanged FIN-1 behavior, renamed field)", async () => {
    catalogRows = [
      { id: "t1", name: "Root Canal", category: "Endodontics", default_price: 25000, direct_cost: 600 },
    ];
    actualsRows = [
      { clinic_id: CLINIC_ID, treatment_name_normalized: "root canal", performed_count: 2, revenue: 50000 },
    ];

    const report = await getTreatmentProfitabilityReportForPeriod(START, END, "Custom");
    const row = report.rows[0];

    expect(row.estimatedDirectCosts).toBe(1200);
    expect(row.estimatedGrossProfit).toBe(50000 - 1200);
    expect(row.estimatedGrossMargin).toBeCloseTo(((50000 - 1200) / 50000) * 100);
  });

  it("computes actualMaterialCost/actualGrossProfit from real recorded consumption, never the estimate", async () => {
    catalogRows = [
      { id: "t1", name: "Root Canal", category: "Endodontics", default_price: 25000, direct_cost: 600 },
    ];
    actualsRows = [
      { clinic_id: CLINIC_ID, treatment_name_normalized: "root canal", performed_count: 1, revenue: 25000 },
    ];
    actualMaterialCostRows = [
      { clinic_id: CLINIC_ID, treatment_name_normalized: "root canal", actual_material_cost: 800 },
    ];

    const report = await getTreatmentProfitabilityReportForPeriod(START, END, "Custom");
    const row = report.rows[0];

    expect(row.actualMaterialCost).toBe(800);
    expect(row.actualGrossProfit).toBe(25000 - 800);
    expect(row.actualGrossMargin).toBeCloseTo(((25000 - 800) / 25000) * 100);

    // The brief's exact deterministic scenario.
    expect(row.actualGrossProfit).toBe(24200);
  });

  it("defaults actualMaterialCost to 0 (never the estimate) when no materials were recorded, even though direct_cost is configured", async () => {
    catalogRows = [
      { id: "t1", name: "Whitening", category: "Cosmetic", default_price: 10000, direct_cost: 300 },
    ];
    actualsRows = [
      { clinic_id: CLINIC_ID, treatment_name_normalized: "whitening", performed_count: 1, revenue: 10000 },
    ];
    actualMaterialCostRows = [];

    const report = await getTreatmentProfitabilityReportForPeriod(START, END, "Custom");
    const row = report.rows[0];

    expect(row.actualMaterialCost).toBe(0);
    expect(row.actualGrossProfit).toBe(10000);
    // Confirms this is genuinely distinct from the estimate (300 * 1 = 300).
    expect(row.estimatedDirectCosts).toBe(300);
  });

  it("leaves actualGrossProfit/actualGrossMargin null for a treatment not performed in this period", async () => {
    catalogRows = [
      { id: "t1", name: "Extraction", category: "Surgery", default_price: 5000, direct_cost: 200 },
    ];
    actualsRows = [];
    actualMaterialCostRows = [];

    const report = await getTreatmentProfitabilityReportForPeriod(START, END, "Custom");
    const row = report.rows[0];

    expect(row.performedCount).toBe(0);
    expect(row.actualMaterialCost).toBe(0);
    expect(row.actualGrossProfit).toBeNull();
    expect(row.actualGrossMargin).toBeNull();
  });

  it("summary sums actual material cost/profit across every performed row, regardless of whether direct_cost is configured", async () => {
    catalogRows = [
      { id: "t1", name: "Root Canal", category: "Endodontics", default_price: 25000, direct_cost: 600 },
      { id: "t2", name: "Cleaning", category: "Preventive", default_price: 3000, direct_cost: null },
    ];
    actualsRows = [
      { clinic_id: CLINIC_ID, treatment_name_normalized: "root canal", performed_count: 1, revenue: 25000 },
      { clinic_id: CLINIC_ID, treatment_name_normalized: "cleaning", performed_count: 2, revenue: 6000 },
    ];
    actualMaterialCostRows = [
      { clinic_id: CLINIC_ID, treatment_name_normalized: "root canal", actual_material_cost: 800 },
      { clinic_id: CLINIC_ID, treatment_name_normalized: "cleaning", actual_material_cost: 100 },
    ];

    const report = await getTreatmentProfitabilityReportForPeriod(START, END, "Custom");

    // totalActualMaterialCost includes the "cleaning" row (900 total) even
    // though it has no configured direct_cost - unlike the estimate-based
    // totalDirectCosts, which only ever covers cost-configured rows.
    expect(report.summary.totalActualMaterialCost).toBe(900);
    expect(report.summary.totalActualGrossProfit).toBe(31000 - 900);
    expect(report.summary.averageActualGrossMargin).toBeCloseTo(
      ((31000 - 900) / 31000) * 100
    );
  });

  it("passes the exact clinic id and ISO start/end to the actual material cost RPC", async () => {
    catalogRows = [];

    await getTreatmentProfitabilityReportForPeriod(START, END, "Custom");

    expect(mockClient.rpc).toHaveBeenCalledWith(
      "get_treatment_actual_material_costs_multi",
      {
        p_clinic_ids: [CLINIC_ID],
        p_start: START.toISOString(),
        p_end: END.toISOString(),
      }
    );
  });
});
