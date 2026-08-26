import { describe, expect, it, vi, beforeEach } from "vitest";

import { TreatmentPlanItem } from "@/types/treatmentPlan";

const getCurrentClinicId = vi.fn();
const getCurrentClinicUser = vi.fn();

vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

vi.mock("./clinicUsers", () => ({
  getCurrentClinicUser: () => getCurrentClinicUser(),
}));

vi.mock("./billing", () => ({
  createInvoice: vi.fn(),
}));

vi.mock("./authorization", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("./notifications", () => ({
  notifyTreatmentPlanCreated: vi.fn(),
  notifyTreatmentCompleted: vi.fn(),
}));

type Call = { method: string; args: unknown[] };
type TableHandler = (info: { op: string; calls: Call[] }) => {
  data: unknown;
  error: unknown;
};

function createSupabaseMock(
  handlers: Record<string, TableHandler> = {},
  rpcHandler?: (name: string, args: unknown) => { data: unknown; error: unknown }
) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      let op = "select";

      const builder = {
        select: (...args: unknown[]) => {
          op = "select";
          calls.push({ method: "select", args });
          return builder;
        },
        insert: (...args: unknown[]) => {
          op = "insert";
          calls.push({ method: "insert", args });
          return builder;
        },
        update: (...args: unknown[]) => {
          op = "update";
          calls.push({ method: "update", args });
          return builder;
        },
        delete: (...args: unknown[]) => {
          op = "delete";
          calls.push({ method: "delete", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          calls.push({ method: "eq", args });
          return builder;
        },
        in: (...args: unknown[]) => {
          calls.push({ method: "in", args });
          return builder;
        },
        single: (...args: unknown[]) => {
          calls.push({ method: "single", args });
          return builder;
        },
        maybeSingle: (...args: unknown[]) => {
          calls.push({ method: "maybeSingle", args });
          return builder;
        },
        then(
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          const handler = handlers[table];

          const result = handler
            ? handler({ op, calls })
            : { data: null, error: null };

          return Promise.resolve(result).then(resolve, reject);
        },
      };

      return builder;
    },
    rpc(name: string, args: unknown) {
      const result = rpcHandler
        ? rpcHandler(name, args)
        : { data: null, error: null };

      return Promise.resolve(result);
    },
  };
}

let mockClient: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const {
  createTreatment,
  updateTreatmentTeeth,
  updateTreatmentItem,
  getItemTeeth,
  isItemInvoiced,
  billTreatmentPlanItems,
} = await import("./treatmentPlans");

const { createInvoice } = await import("./billing");

const CLINIC_ID = "clinic-a";

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  getCurrentClinicUser.mockReset();
  vi.mocked(createInvoice).mockReset();
  mockClient = createSupabaseMock();
});

function makeItem(
  overrides: Partial<TreatmentPlanItem> = {}
): TreatmentPlanItem {
  return {
    id: "item-1",
    clinic_id: CLINIC_ID,
    treatment_plan_id: "plan-1",
    procedure: "Composite Restoration",
    tooth_number: null,
    estimated_price: 5000,
    quantity: 1,
    notes: null,
    priority: "Medium",
    status: "Planned",
    sort_order: 0,
    charge_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(items: TreatmentPlanItem[]) {
  return {
    id: "plan-1",
    clinic_id: CLINIC_ID,
    patient_id: "patient-1",
    created_by: null,
    title: "Comprehensive Care",
    notes: null,
    status: "Planned" as const,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    treatment_plan_items: items,
  };
}

/* -------------------------------------- */
/* getItemTeeth                           */
/* -------------------------------------- */

describe("getItemTeeth", () => {
  it("prefers treatment_teeth over the legacy tooth_number", () => {
    const item = makeItem({
      tooth_number: 16,
      treatment_teeth: [{ tooth_number: 17 }, { tooth_number: 16 }],
    });

    expect(getItemTeeth(item)).toEqual([16, 17]);
  });

  it("sorts a grouped treatment's teeth ascending", () => {
    const item = makeItem({
      treatment_teeth: [
        { tooth_number: 18 },
        { tooth_number: 16 },
        { tooth_number: 17 },
      ],
    });

    expect(getItemTeeth(item)).toEqual([16, 17, 18]);
  });

  it("falls back to tooth_number when treatment_teeth is empty", () => {
    const item = makeItem({ tooth_number: 30, treatment_teeth: [] });

    expect(getItemTeeth(item)).toEqual([30]);
  });

  it("falls back to tooth_number when treatment_teeth wasn't fetched at all", () => {
    const item = makeItem({ tooth_number: 30, treatment_teeth: undefined });

    expect(getItemTeeth(item)).toEqual([30]);
  });

  it("returns an empty array when there is no tooth information at all", () => {
    const item = makeItem({ tooth_number: null, treatment_teeth: [] });

    expect(getItemTeeth(item)).toEqual([]);
  });
});

/* -------------------------------------- */
/* isItemInvoiced (Phase H)               */
/* -------------------------------------- */

describe("isItemInvoiced", () => {
  it("is NOT invoiced when the linked charge is still Pending, even though charge_id is set", () => {
    // The exact bug Phase H introduced and this function fixes: every
    // billable Treatment gets a charge_id immediately on creation, while
    // still Pending - charge_id alone must never be read as "invoiced".
    const item = makeItem({
      charge_id: "charge-1",
      clinic_charges: { status: "Pending" },
    });

    expect(isItemInvoiced(item)).toBe(false);
  });

  it("IS invoiced when the linked charge's status is Invoiced", () => {
    const item = makeItem({
      charge_id: "charge-1",
      clinic_charges: { status: "Invoiced" },
    });

    expect(isItemInvoiced(item)).toBe(true);
  });

  it("is not invoiced when there is no charge at all", () => {
    const item = makeItem({ charge_id: null, clinic_charges: null });

    expect(isItemInvoiced(item)).toBe(false);
  });

  it("falls back to charge_id presence when the nested charge embed wasn't fetched (pre-Phase-H caller)", () => {
    const invoicedFallback = makeItem({ charge_id: "charge-1", clinic_charges: undefined });
    const unbilledFallback = makeItem({ charge_id: null, clinic_charges: undefined });

    expect(isItemInvoiced(invoicedFallback)).toBe(true);
    expect(isItemInvoiced(unbilledFallback)).toBe(false);
  });
});

/* -------------------------------------- */
/* createTreatment (canonical)            */
/* -------------------------------------- */

describe("createTreatment", () => {
  it("rejects an empty treatment name before ever calling the database", async () => {
    await expect(
      createTreatment({
        treatment_plan_id: "plan-1",
        procedure: "   ",
        tooth_numbers: [16],
        estimated_price: 5000,
        quantity: 1,
        notes: null,
        priority: "Medium",
        status: "Planned",
      })
    ).rejects.toThrow(/choose a treatment/i);
  });

  it("rejects an invalid tooth number before ever calling the database", async () => {
    await expect(
      createTreatment({
        treatment_plan_id: "plan-1",
        procedure: "Composite Restoration",
        // 19 is an FDI "gap" value (between quadrant 1's 18 and quadrant
        // 2's 21) - genuinely invalid, unlike a plain >32 check.
        tooth_numbers: [19],
        estimated_price: 5000,
        quantity: 1,
        notes: null,
        priority: "Medium",
        status: "Planned",
      })
    ).rejects.toThrow(/invalid/i);
  });

  it("calls create_treatment_with_teeth once with quantity set to the tooth count", async () => {
    let capturedName = "";
    let capturedArgs: any = null;

    mockClient = createSupabaseMock(
      {
        treatment_plans: () => ({
          data: null,
          error: null,
        }),
      },
      (name, args) => {
        capturedName = name;
        capturedArgs = args;
        return { data: makeItem({ id: "new-item" }), error: null };
      }
    );

    const result = await createTreatment({
      treatment_plan_id: "plan-1",
      procedure: "Composite Restoration",
      tooth_numbers: [18, 16, 17],
      estimated_price: 5000,
      quantity: 1,
      notes: "  some notes  ",
      priority: "High",
      status: "Planned",
    });

    expect(capturedName).toBe("create_treatment_with_teeth");
    expect(capturedArgs).toMatchObject({
      p_treatment_plan_id: "plan-1",
      p_procedure: "Composite Restoration",
      p_tooth_numbers: [18, 16, 17],
      p_estimated_price: 5000,
      p_quantity: 3,
      p_notes: "some notes",
      p_priority: "High",
      p_status: "Planned",
    });

    expect(result.id).toBe("new-item");
  });

  it("propagates an RPC error instead of reporting false success", async () => {
    mockClient = createSupabaseMock(
      {},
      () => ({ data: null, error: new Error("plan not found") })
    );

    await expect(
      createTreatment({
        treatment_plan_id: "missing-plan",
        procedure: "Composite Restoration",
        tooth_numbers: [16],
        estimated_price: 5000,
        quantity: 1,
        notes: null,
        priority: "Medium",
        status: "Planned",
      })
    ).rejects.toThrow("plan not found");
  });

  it("passes a single-element array for a one-tooth grouped treatment", async () => {
    let capturedArgs: any = null;

    mockClient = createSupabaseMock({}, (_name, args) => {
      capturedArgs = args;
      return { data: makeItem(), error: null };
    });

    await createTreatment({
      treatment_plan_id: "plan-1",
      procedure: "Root Canal",
      tooth_numbers: [36],
      estimated_price: 25000,
      quantity: 1,
      notes: null,
      priority: "Medium",
      status: "Planned",
    });

    expect(capturedArgs.p_tooth_numbers).toEqual([36]);
    expect(capturedArgs.p_quantity).toBe(1);
  });

  it("creates a no-tooth Treatment using the caller-supplied quantity, not a tooth count", async () => {
    let capturedArgs: any = null;

    mockClient = createSupabaseMock({}, (_name, args) => {
      capturedArgs = args;
      return { data: makeItem({ tooth_number: null }), error: null };
    });

    await createTreatment({
      treatment_plan_id: "plan-1",
      procedure: "Consultation",
      tooth_numbers: [],
      estimated_price: 2000,
      quantity: 3,
      notes: null,
      priority: "Medium",
      status: "Planned",
    });

    expect(capturedArgs.p_tooth_numbers).toEqual([]);
    expect(capturedArgs.p_quantity).toBe(3);
  });

  it("floors a no-tooth Treatment's quantity at 1", async () => {
    let capturedArgs: any = null;

    mockClient = createSupabaseMock({}, (_name, args) => {
      capturedArgs = args;
      return { data: makeItem(), error: null };
    });

    await createTreatment({
      treatment_plan_id: "plan-1",
      procedure: "Consultation",
      tooth_numbers: [],
      estimated_price: 2000,
      quantity: 0,
      notes: null,
      priority: "Medium",
      status: "Planned",
    });

    expect(capturedArgs.p_quantity).toBe(1);
  });
});

/* -------------------------------------- */
/* updateTreatmentTeeth                   */
/* -------------------------------------- */

describe("updateTreatmentTeeth", () => {
  it("rejects an invalid tooth number before ever calling the database", async () => {
    await expect(
      updateTreatmentTeeth("item-1", [4])
    ).rejects.toThrow(/invalid/i);
  });

  it("allows replacing a Treatment's teeth with an empty set", async () => {
    let capturedArgs: any = null;

    mockClient = createSupabaseMock({}, (_name, args) => {
      capturedArgs = args;
      return { data: makeItem({ tooth_number: null }), error: null };
    });

    await updateTreatmentTeeth("item-1", []);

    expect(capturedArgs).toEqual({
      p_treatment_plan_item_id: "item-1",
      p_tooth_numbers: [],
    });
  });

  it("calls update_treatment_teeth with the new tooth set", async () => {
    let capturedName = "";
    let capturedArgs: any = null;

    mockClient = createSupabaseMock({}, (name, args) => {
      capturedName = name;
      capturedArgs = args;
      return { data: makeItem({ tooth_number: null }), error: null };
    });

    const result = await updateTreatmentTeeth("item-1", [17, 16]);

    expect(capturedName).toBe("update_treatment_teeth");
    expect(capturedArgs).toEqual({
      p_treatment_plan_item_id: "item-1",
      p_tooth_numbers: [17, 16],
    });
    expect(result.id).toBe("item-1");
  });

  it("propagates the billing-safety error from the RPC instead of reporting false success", async () => {
    mockClient = createSupabaseMock({}, () => ({
      data: null,
      error: new Error(
        "This treatment has already been invoiced, so its teeth can no longer be changed."
      ),
    }));

    await expect(
      updateTreatmentTeeth("invoiced-item", [16])
    ).rejects.toThrow(/already been invoiced/i);
  });
});

/* -------------------------------------- */
/* updateTreatmentItem charge sync (Phase H) */
/* -------------------------------------- */

describe("updateTreatmentItem - charge synchronization (Phase H section 10)", () => {
  it("calls sync_treatment_charge_amount when estimated_price changes", async () => {
    let rpcName = "";
    let rpcArgs: unknown = null;
    let itemsQueryCount = 0;

    mockClient = createSupabaseMock(
      {
        treatment_plan_items: () => {
          itemsQueryCount += 1;

          if (itemsQueryCount === 1) {
            // Existing-status lookup (Completed-notification check).
            return { data: { status: "Planned" }, error: null };
          }

          if (itemsQueryCount === 2) {
            // The main scalar update.
            return {
              data: makeItem({ id: "item-1", estimated_price: 8000 }),
              error: null,
            };
          }

          // Refetch after the sync RPC.
          return {
            data: makeItem({ id: "item-1", estimated_price: 8000 }),
            error: null,
          };
        },
      },
      (name, args) => {
        rpcName = name;
        rpcArgs = args;
        return { data: null, error: null };
      }
    );

    await updateTreatmentItem("item-1", { estimated_price: 8000 });

    expect(rpcName).toBe("sync_treatment_charge_amount");
    expect(rpcArgs).toEqual({ p_treatment_plan_item_id: "item-1" });
  });

  it("does NOT call sync_treatment_charge_amount for a non-price-affecting edit (notes only)", async () => {
    let rpcCalled = false;

    mockClient = createSupabaseMock(
      {
        treatment_plan_items: () => ({
          data: makeItem({ id: "item-1", notes: "updated note" }),
          error: null,
        }),
      },
      () => {
        rpcCalled = true;
        return { data: null, error: null };
      }
    );

    await updateTreatmentItem("item-1", { notes: "updated note" });

    expect(rpcCalled).toBe(false);
  });

  it("propagates a sync RPC error instead of reporting false success", async () => {
    mockClient = createSupabaseMock(
      {
        treatment_plan_items: () => ({
          data: makeItem({ id: "item-1" }),
          error: null,
        }),
      },
      () => ({ data: null, error: new Error("sync failed") })
    );

    await expect(
      updateTreatmentItem("item-1", { quantity: 5 })
    ).rejects.toThrow("sync failed");
  });
});

/* -------------------------------------- */
/* billTreatmentPlanItems (Phase G)       */
/* -------------------------------------- */

describe("billTreatmentPlanItems", () => {
  it("creates a charge with treatment_plan_item_id set to the billed item's id (Phase G section 8)", async () => {
    let capturedInsert: Record<string, unknown> | null = null;

    mockClient = createSupabaseMock({
      clinic_charges: (info) => {
        const insertCall = info.calls.find((c) => c.method === "insert");
        const inserted = insertCall?.args[0] as Record<string, unknown> | undefined;
        if (insertCall) {
          capturedInsert = inserted ?? null;
        }
        return {
          data: { id: "charge-1", treatment_name: inserted?.treatment_name, amount: inserted?.amount },
          error: null,
        };
      },
      treatment_plan_items: () => ({ data: null, error: null }),
    });

    const plan = makePlan([makeItem({ id: "item-1", charge_id: null })]);

    await billTreatmentPlanItems(plan, "all");

    expect(capturedInsert).toMatchObject({
      treatment_plan_item_id: "item-1",
      status: "Pending",
    });
    expect(createInvoice).toHaveBeenCalled();
  });

  it("never re-bills an item whose linked charge is already Invoiced (duplicate-billing guard, Phase H)", async () => {
    let chargesInsertCalled = false;

    mockClient = createSupabaseMock({
      clinic_charges: (info) => {
        if (info.op === "insert") {
          chargesInsertCalled = true;
          return { data: null, error: null };
        }

        // The status lookup billTreatmentPlanItems now runs before
        // deciding what's unbilled (Phase H: charge_id alone no longer
        // means "already invoiced", since every billable Treatment gets
        // one immediately on creation - only the charge's own status
        // does).
        return {
          data: [{ id: "already-billed-charge", status: "Invoiced" }],
          error: null,
        };
      },
    });

    const plan = makePlan([
      makeItem({ id: "item-1", charge_id: "already-billed-charge" }),
    ]);

    await expect(billTreatmentPlanItems(plan, "all")).rejects.toThrow(
      /already been invoiced/i
    );

    expect(chargesInsertCalled).toBe(false);
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it("DOES re-bill an item whose linked charge is still Pending (Phase H: charge_id alone no longer means invoiced)", async () => {
    let capturedInsert: Record<string, unknown> | null = null;

    mockClient = createSupabaseMock({
      clinic_charges: (info) => {
        if (info.op === "select") {
          return {
            data: [{ id: "pending-charge", status: "Pending" }],
            error: null,
          };
        }

        const insertCall = info.calls.find((c) => c.method === "insert");
        if (insertCall) {
          capturedInsert = insertCall.args[0] as Record<string, unknown>;
        }

        return { data: null, error: null };
      },
      treatment_plan_items: () => ({ data: null, error: null }),
    });

    const plan = makePlan([
      makeItem({ id: "item-1", charge_id: "pending-charge" }),
    ]);

    await billTreatmentPlanItems(plan, "all");

    // A charge already exists and is Pending - use it directly, don't
    // insert a second one for the same item.
    expect(capturedInsert).toBeNull();
    expect(createInvoice).toHaveBeenCalledWith(
      "patient-1",
      [{ id: "pending-charge", treatment_name: "Composite Restoration", amount: 5000 }],
      0,
      undefined,
      undefined,
      undefined
    );
  });

  it("bills a grouped 3-tooth Treatment as one charge with quantity x price (16,17,18)", async () => {
    let capturedInsert: Record<string, unknown> | null = null;

    mockClient = createSupabaseMock({
      clinic_charges: (info) => {
        const insertCall = info.calls.find((c) => c.method === "insert");
        const inserted = insertCall?.args[0] as Record<string, unknown> | undefined;
        if (insertCall) {
          capturedInsert = inserted ?? null;
        }
        return {
          data: { id: "charge-1", treatment_name: inserted?.treatment_name, amount: inserted?.amount },
          error: null,
        };
      },
      treatment_plan_items: () => ({ data: null, error: null }),
    });

    const plan = makePlan([
      makeItem({
        id: "item-grouped",
        procedure: "Root Canal",
        tooth_number: null,
        estimated_price: 20000,
        quantity: 3,
        charge_id: null,
      }),
    ]);

    await billTreatmentPlanItems(plan, "all");

    // One charge, amount = price-per-tooth (20,000) x quantity (3) =
    // 60,000 - never one charge per tooth.
    expect(capturedInsert).toMatchObject({
      amount: 60000,
      treatment_plan_item_id: "item-grouped",
    });

    const invoiceCall = vi.mocked(createInvoice).mock.calls[0];
    const chargesArg = invoiceCall[1] as Array<{ amount: number }>;
    expect(chargesArg).toHaveLength(1);
    expect(chargesArg[0].amount).toBe(60000);
  });
});
