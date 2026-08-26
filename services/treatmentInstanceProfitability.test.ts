import { beforeEach, describe, expect, it, vi } from "vitest";

// FIN-2.5: exercises the REAL getTreatmentInstanceProfitability(...)
// implementations against a mocked Supabase boundary - proves per-instance
// revenue/actual-cost/gross-profit attribution is correct without a live
// database (the live, rolled-back-transaction verification covers the
// actual RLS/constraint/DB behavior separately - see the FIN-2.5 report).

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

const CLINIC_ID = "clinic-1";

interface Tables {
  treatment_plan_items?: unknown;
  treatment_plans?: unknown;
  patients?: unknown;
  clinic_invoices?: unknown;
  treatment_material_usage?: unknown;
}

let tables: Tables = {};
const calls: { table: string; method: string; args: unknown[] }[] = [];

function createSupabaseMock() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          calls.push({ table, method: "eq", args });
          return builder;
        },
        in: (...args: unknown[]) => {
          calls.push({ table, method: "in", args });
          return builder;
        },
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        range: () => builder,
        single: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          const data = (tables as Record<string, unknown>)[table] ?? [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

let mockClient: ReturnType<typeof createSupabaseMock>;

const {
  getTreatmentInstanceProfitability,
  getTreatmentInstanceProfitabilityForCatalogTreatment,
} = await import("./treatmentInstanceProfitability");

const PATIENT_A = { id: "patient-a", first_name: "Amina", last_name: "Otieno" };
const PATIENT_B = { id: "patient-b", first_name: "Brian", last_name: "Kamau" };

function tpi(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpi-1",
    clinic_id: CLINIC_ID,
    treatment_plan_id: "plan-1",
    procedure: "Root Canal",
    tooth_number: 16,
    status: "Completed",
    created_at: "2026-08-10T00:00:00.000Z",
    treatment_teeth: [],
    clinic_charges: null,
    ...overrides,
  };
}

function charge(overrides: Record<string, unknown> = {}) {
  return { id: "charge-1", status: "Invoiced", amount: 15000, invoice_id: "inv-1", ...overrides };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoice_number: "INV-0001",
    status: "Paid",
    amount_paid: 15000,
    balance: 0,
    ...overrides,
  };
}

function usage(overrides: Record<string, unknown> = {}) {
  return {
    treatment_plan_item_id: "tpi-1",
    inventory_item_id: "inv-item-1",
    quantity: 0.25,
    unit_cost: 1000,
    clinic_inventory_items: { name: "Gutta-percha", unit: "unit" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  mockClient = createSupabaseMock();
  tables = {
    treatment_plan_items: [tpi({ clinic_charges: charge() })],
    treatment_plans: [{ id: "plan-1", patient_id: PATIENT_A.id }],
    patients: [PATIENT_A],
    clinic_invoices: [invoice()],
    treatment_material_usage: [usage()],
  };
});

describe("getTreatmentInstanceProfitability (single instance)", () => {
  it("Scenario: one treatment invoiced, with materials - the brief's exact deterministic scenario", async () => {
    tables.treatment_plan_items = tpi({ clinic_charges: charge({ amount: 15000 }) });
    tables.treatment_material_usage = [
      { ...usage({ inventory_item_id: "a", quantity: 0.25, unit_cost: 1000, clinic_inventory_items: { name: "Composite", unit: "unit" } }) },
      { ...usage({ inventory_item_id: "b", quantity: 2, unit_cost: 300, clinic_inventory_items: { name: "Anesthetic", unit: "unit" } }) },
      { ...usage({ inventory_item_id: "c", quantity: 1, unit_cost: 400, clinic_inventory_items: { name: "Files", unit: "unit" } }) },
    ];

    const result = await getTreatmentInstanceProfitability("tpi-1");

    expect(result.revenue).toBe(15000);
    expect(result.actualMaterialCost).toBe(1250); // 250 + 600 + 400
    expect(result.grossProfit).toBe(13750);
    expect(result.grossMarginPercent).toBeCloseTo(91.6667, 3);
    expect(result.billingStatus).toBe("Invoiced");
    expect(result.materials).toHaveLength(3);
  });

  it("Scenario 5: revenue but no materials -> material cost 0, gross profit = revenue", async () => {
    tables.treatment_plan_items = tpi({ clinic_charges: charge({ amount: 5000 }) });
    tables.treatment_material_usage = [];

    const result = await getTreatmentInstanceProfitability("tpi-1");

    expect(result.actualMaterialCost).toBe(0);
    expect(result.revenue).toBe(5000);
    expect(result.grossProfit).toBe(5000);
    expect(result.grossMarginPercent).toBe(100);
  });

  it("Scenario 6: materials but no linked revenue (NoCharge) -> cost visible, revenue 0, margin null (never divide by zero)", async () => {
    tables.treatment_plan_items = tpi({ clinic_charges: null });
    tables.treatment_material_usage = [usage({ quantity: 1, unit_cost: 800 })];

    const result = await getTreatmentInstanceProfitability("tpi-1");

    expect(result.billingStatus).toBe("NoCharge");
    expect(result.revenue).toBe(0);
    expect(result.actualMaterialCost).toBe(800);
    expect(result.grossProfit).toBe(-800);
    expect(result.grossMarginPercent).toBeNull();
  });

  it("Scenario 4: a Pending (not yet invoiced) charge does not fabricate revenue", async () => {
    tables.treatment_plan_items = tpi({ clinic_charges: charge({ status: "Pending", amount: 25000, invoice_id: null }) });
    tables.treatment_material_usage = [];

    const result = await getTreatmentInstanceProfitability("tpi-1");

    expect(result.billingStatus).toBe("Pending");
    expect(result.revenue).toBe(0);
    expect(result.grossProfit).toBe(0);
    expect(result.grossMarginPercent).toBeNull();
  });

  it("never reads clinic_treatments.direct_cost - actual cost comes only from treatment_material_usage", async () => {
    // No clinic_treatments table is even registered in the mock - if the
    // service tried to read it, this test's mock would return an empty
    // array by default rather than throwing, so this is reinforced by the
    // absence of any clinic_treatments reference in the source file
    // (see the module's own doc comment) plus this call succeeding at all
    // using only the tables actually mocked here.
    tables.treatment_plan_items = tpi({ clinic_charges: charge({ amount: 1000 }) });

    const result = await getTreatmentInstanceProfitability("tpi-1");

    expect(result).toBeDefined();
    expect(calls.some((c) => c.table === "clinic_treatments")).toBe(false);
  });

  it("scopes the treatment lookup to the current clinic (isolation)", async () => {
    await getTreatmentInstanceProfitability("tpi-1");

    const eqCalls = calls.filter((c) => c.table === "treatment_plan_items" && c.method === "eq");
    expect(eqCalls).toContainEqual({ table: "treatment_plan_items", method: "eq", args: ["clinic_id", CLINIC_ID] });
  });

  it("surfaces invoice-level payment context separately from revenue, never blended into it", async () => {
    tables.treatment_plan_items = tpi({ clinic_charges: charge({ amount: 20000, invoice_id: "inv-1" }) });
    tables.clinic_invoices = [invoice({ id: "inv-1", status: "Partially Paid", amount_paid: 8000, balance: 12000 })];

    const result = await getTreatmentInstanceProfitability("tpi-1");

    expect(result.revenue).toBe(20000); // recognized (accrual), unaffected by partial payment
    expect(result.invoiceStatus).toBe("Partially Paid");
    expect(result.invoiceAmountPaid).toBe(8000);
    expect(result.invoiceBalance).toBe(12000);
  });
});

describe("getTreatmentInstanceProfitabilityForCatalogTreatment (multi-instance)", () => {
  it("Scenario 3: two identical treatment names for the same patient each get their own distinct revenue, never merged/duplicated", async () => {
    tables.treatment_plan_items = [
      tpi({ id: "tpi-1", clinic_charges: charge({ id: "charge-1", amount: 15000, invoice_id: "inv-1" }) }),
      tpi({ id: "tpi-2", clinic_charges: charge({ id: "charge-2", amount: 18000, invoice_id: "inv-1" }) }),
    ];
    tables.clinic_invoices = [invoice({ id: "inv-1" })];
    tables.treatment_material_usage = [];

    const results = await getTreatmentInstanceProfitabilityForCatalogTreatment("Root Canal", null, null);

    expect(results).toHaveLength(2);
    const revenues = results.map((r) => r.revenue).sort((a, b) => a - b);
    expect(revenues).toEqual([15000, 18000]);

    const ids = new Set(results.map((r) => r.treatmentPlanItemId));
    expect(ids.size).toBe(2); // never duplicated
  });

  it("Scenario 2: two different treatments on the same invoice each keep only their own revenue", async () => {
    tables.treatment_plan_items = [
      tpi({ id: "tpi-1", procedure: "Root Canal", clinic_charges: charge({ id: "charge-1", amount: 15000, invoice_id: "inv-1" }) }),
      tpi({ id: "tpi-2", procedure: "Cleaning", clinic_charges: charge({ id: "charge-2", amount: 3000, invoice_id: "inv-1" }) }),
    ];
    tables.clinic_invoices = [invoice({ id: "inv-1" })];

    const rootCanalResults = await getTreatmentInstanceProfitabilityForCatalogTreatment("Root Canal", null, null);
    expect(rootCanalResults).toHaveLength(1);
    expect(rootCanalResults[0].revenue).toBe(15000);

    const cleaningResults = await getTreatmentInstanceProfitabilityForCatalogTreatment("Cleaning", null, null);
    expect(cleaningResults).toHaveLength(1);
    expect(cleaningResults[0].revenue).toBe(3000);
  });

  it("Scenario 7: multiple material usages on one treatment aggregate correctly", async () => {
    tables.treatment_plan_items = [tpi({ clinic_charges: charge({ amount: 10000 }) })];
    tables.treatment_material_usage = [
      usage({ inventory_item_id: "a", quantity: 1, unit_cost: 100 }),
      usage({ inventory_item_id: "b", quantity: 2, unit_cost: 250 }),
      usage({ inventory_item_id: "c", quantity: 0.5, unit_cost: 400 }),
    ];

    const results = await getTreatmentInstanceProfitabilityForCatalogTreatment("Root Canal", null, null);

    expect(results[0].actualMaterialCost).toBe(100 + 500 + 200);
    expect(results[0].materials).toHaveLength(3);
  });

  it("matches by normalized procedure name (case/whitespace-insensitive), never fuzzily beyond that", async () => {
    tables.treatment_plan_items = [
      tpi({ id: "tpi-1", procedure: "  root canal  ", clinic_charges: null }),
      tpi({ id: "tpi-2", procedure: "Root Canal Retreatment", clinic_charges: null }),
    ];

    const results = await getTreatmentInstanceProfitabilityForCatalogTreatment("Root Canal", null, null);

    expect(results).toHaveLength(1);
    expect(results[0].treatmentPlanItemId).toBe("tpi-1");
  });

  it("returns an empty list rather than throwing when nothing matches", async () => {
    tables.treatment_plan_items = [];

    const results = await getTreatmentInstanceProfitabilityForCatalogTreatment("Root Canal", null, null);

    expect(results).toEqual([]);
  });

  it("resolves each instance's own patient across two different patients correctly", async () => {
    tables.treatment_plan_items = [
      tpi({ id: "tpi-1", treatment_plan_id: "plan-a", clinic_charges: null }),
      tpi({ id: "tpi-2", treatment_plan_id: "plan-b", clinic_charges: null }),
    ];
    tables.treatment_plans = [
      { id: "plan-a", patient_id: PATIENT_A.id },
      { id: "plan-b", patient_id: PATIENT_B.id },
    ];
    tables.patients = [PATIENT_A, PATIENT_B];

    const results = await getTreatmentInstanceProfitabilityForCatalogTreatment("Root Canal", null, null);

    const byId = new Map(results.map((r) => [r.treatmentPlanItemId, r]));
    expect(byId.get("tpi-1")?.patientName).toBe("Amina Otieno");
    expect(byId.get("tpi-2")?.patientName).toBe("Brian Kamau");
  });
});
