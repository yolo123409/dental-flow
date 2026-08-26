import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

type Call = { method: string; args: unknown[] };

function createSupabaseMock(
  handler: (info: { calls: Call[] }) => { data: unknown; error: unknown }
) {
  return {
    from() {
      const calls: Call[] = [];

      const builder: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          calls.push({ method: "select", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          calls.push({ method: "eq", args });
          return builder;
        },
        order: (...args: unknown[]) => {
          calls.push({ method: "order", args });
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(handler({ calls })).then(resolve),
      };

      return builder;
    },
    rpc: vi.fn(),
  };
}

let mockClient: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const {
  getTreatmentMaterialUsage,
  addTreatmentMaterial,
  updateTreatmentMaterialQuantity,
  removeTreatmentMaterial,
} = await import("./treatmentMaterialUsage");

const CLINIC_ID = "clinic-1";
const TREATMENT_PLAN_ITEM_ID = "tpi-1";
const INVENTORY_ITEM_ID = "inv-1";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);

  mockClient = createSupabaseMock(() => ({ data: [], error: null }));
});

describe("getTreatmentMaterialUsage", () => {
  it("scopes the read to the current clinic and the given treatment instance", async () => {
    const row = {
      id: "usage-1",
      clinic_id: CLINIC_ID,
      treatment_plan_item_id: TREATMENT_PLAN_ITEM_ID,
      inventory_item_id: INVENTORY_ITEM_ID,
      quantity: 2,
      unit_cost: 50,
    };

    let capturedCalls: Call[] = [];

    mockClient = createSupabaseMock(({ calls }) => {
      capturedCalls = calls;
      return { data: [row], error: null };
    });

    const result = await getTreatmentMaterialUsage(TREATMENT_PLAN_ITEM_ID);

    expect(result).toEqual([row]);

    const eqCalls = capturedCalls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["clinic_id", CLINIC_ID] });
    expect(eqCalls).toContainEqual({
      method: "eq",
      args: ["treatment_plan_item_id", TREATMENT_PLAN_ITEM_ID],
    });
  });

  it("throws when the underlying query errors", async () => {
    mockClient = createSupabaseMock(() => ({
      data: null,
      error: { message: "boom" },
    }));

    await expect(getTreatmentMaterialUsage(TREATMENT_PLAN_ITEM_ID)).rejects.toThrow();
  });
});

describe("addTreatmentMaterial", () => {
  it("requires inventory_manage permission before calling the RPC", async () => {
    mockClient.rpc = vi.fn().mockResolvedValue({
      data: { id: "usage-1", quantity: 2, unit_cost: 50 },
      error: null,
    });

    await addTreatmentMaterial(TREATMENT_PLAN_ITEM_ID, INVENTORY_ITEM_ID, 2);

    expect(assertPermission).toHaveBeenCalledWith("inventory_manage");
  });

  it("rejects a zero or negative quantity without calling the RPC", async () => {
    mockClient.rpc = vi.fn();

    await expect(
      addTreatmentMaterial(TREATMENT_PLAN_ITEM_ID, INVENTORY_ITEM_ID, 0)
    ).rejects.toThrow("Enter a quantity greater than 0.");

    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("calls add_treatment_material with exactly the given ids/quantity", async () => {
    mockClient.rpc = vi.fn().mockResolvedValue({
      data: { id: "usage-1", quantity: 1, unit_cost: 500 },
      error: null,
    });

    await addTreatmentMaterial(TREATMENT_PLAN_ITEM_ID, INVENTORY_ITEM_ID, 1, "note");

    expect(mockClient.rpc).toHaveBeenCalledWith("add_treatment_material", {
      p_treatment_plan_item_id: TREATMENT_PLAN_ITEM_ID,
      p_inventory_item_id: INVENTORY_ITEM_ID,
      p_quantity: 1,
      p_notes: "note",
    });
  });

  it("throws when the RPC reports insufficient stock", async () => {
    mockClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Cannot use more than the current stock (0 available)." },
    });

    await expect(
      addTreatmentMaterial(TREATMENT_PLAN_ITEM_ID, INVENTORY_ITEM_ID, 5)
    ).rejects.toThrow(/stock/);
  });
});

describe("updateTreatmentMaterialQuantity / removeTreatmentMaterial", () => {
  it("rejects a negative quantity without calling the RPC", async () => {
    mockClient.rpc = vi.fn();

    await expect(updateTreatmentMaterialQuantity("usage-1", -1)).rejects.toThrow(
      "Quantity cannot be negative."
    );

    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it("calls update_treatment_material_quantity with the usage id and new quantity", async () => {
    mockClient.rpc = vi.fn().mockResolvedValue({
      data: { id: "usage-1", quantity: 3, unit_cost: 50 },
      error: null,
    });

    await updateTreatmentMaterialQuantity("usage-1", 3);

    expect(mockClient.rpc).toHaveBeenCalledWith("update_treatment_material_quantity", {
      p_usage_id: "usage-1",
      p_new_quantity: 3,
    });
  });

  it("returns null when the RPC removes the line (quantity reconciled to 0)", async () => {
    mockClient.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await updateTreatmentMaterialQuantity("usage-1", 0);

    expect(result).toBeNull();
  });

  it("removeTreatmentMaterial delegates to updateTreatmentMaterialQuantity(id, 0)", async () => {
    mockClient.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await removeTreatmentMaterial("usage-1");

    expect(mockClient.rpc).toHaveBeenCalledWith("update_treatment_material_quantity", {
      p_usage_id: "usage-1",
      p_new_quantity: 0,
    });
  });
});
